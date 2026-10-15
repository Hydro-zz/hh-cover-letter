import {
  buildMessages,
  isReasonerModel,
  loadSettings,
  normalizeFullName,
  parseSourceUrl,
  providerApiKey,
  providerEndpoint,
  providerModel,
  resolveMaxTokens,
  resolveProvider,
  resumeKey,
  saveSettings
} from './lib.js';

const RESUME_MIN_LENGTH = 100;
const PAGE_WAIT_MS = 15000;

class UserError extends Error {}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'llm') return;

  let controller = null;
  port.onDisconnect.addListener(() => controller?.abort());

  port.onMessage.addListener(async (msg) => {
    if (msg?.type !== 'generate') return;

    controller?.abort();
    controller = new AbortController();
    const { signal } = controller;

    let context = null;
    let resumeError = null;

    try {
      let settings = await loadSettings();
      const provider = resolveProvider(settings);
      context = { label: provider.label, host: hostOf(provider.baseUrl) };

      if (!provider.baseUrl) {
        throw new UserError('Не указан адрес своего сервера — откройте настройки расширения и заполните поле адреса.');
      }
      if (provider.requiresKey && !providerApiKey(settings)) {
        throw new UserError(
          `Не задан API-ключ ${provider.label} — откройте настройки расширения${
            provider.keyUrl ? `, ключ создаётся на ${provider.keyUrl}` : ''
          }.`
        );
      }
      if (!providerModel(settings)) {
        throw new UserError('Не указано название модели — откройте настройки расширения.');
      }
      if (!settings.resume.trim() && (settings.selectedResumeUrl.trim() || settings.resumeUrl.trim())) {
        const refreshed = await refreshResume();
        if (signal.aborted) return;
        if (refreshed.ok) settings = await loadSettings();
        else resumeError = refreshed.message;
      }
      if (!settings.resume.trim()) {
        throw new UserError(
          resumeError
            ? `Резюме не загружено: ${resumeError}`
            : 'Не заполнено резюме — откройте настройки расширения, укажите ссылку на резюме или профиль и нажмите «Загрузить».'
        );
      }

      const messages = buildMessages(settings, msg.vacancy || {}, settings.resume);
      const { content, reasoningLength, finishReason } = await streamCompletion({
        settings,
        provider,
        messages,
        port,
        signal
      });

      if (signal.aborted) return;

      if (!content.trim()) {
        if (finishReason === 'length') {
          throw new UserError(
            `Модель израсходовала лимит токенов на рассуждения (${reasoningLength} знаков) и не успела написать письмо. ` +
              'Увеличьте «Максимум токенов» в настройках или выберите модель попроще.'
          );
        }
        throw new UserError('Модель вернула пустой ответ. Попробуйте ещё раз.');
      }

      port.postMessage({ type: 'done', length: content.length, finishReason, reasoningLength });
    } catch (error) {
      if (signal.aborted || error?.name === 'AbortError') return;
      port.postMessage({ type: 'error', message: describeError(error, context) });
    }
  });
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'generate-letter') return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'hhcl:generate' });
  } catch {
    // на активной вкладке нет content script (не hh.ru) — тихо игнорируем
  }
});

const MESSAGE_HANDLERS = {
  ping: async () => ({
    ok: true,
    version: chrome.runtime.getManifest().version,
    features: ['resolve-source', 'refresh-resume', 'test-connection', 'status']
  }),
  status: () => statusReport(),
  'test-connection': () => testConnection(),
  'resolve-source': () => resolveSource(),
  'refresh-resume': (msg) => refreshResume(msg?.url)
};

const HANDLED_MESSAGES = Object.keys(MESSAGE_HANDLERS);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = MESSAGE_HANDLERS[msg?.type];
  if (!handler) return undefined;

  Promise.resolve()
    .then(() => handler(msg))
    .then((result) => {
      sendResponse(
        result ?? { ok: false, message: `Пустой ответ фоновой части на «${msg.type}» (${HANDLED_MESSAGES.join(', ')}).` }
      );
    })
    .catch((error) => {
      sendResponse({ ok: false, message: describeError(error) });
    });

  return true;
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function findHhTab(targetUrl) {
  const tabs = await chrome.tabs.query({});
  const wanted = resumeKey(targetUrl);
  if (!wanted) return null;

  // ищем только точное совпадение: подставлять чужое резюме из открытой вкладки нельзя
  return tabs.find((tab) => tab.id && resumeKey(tab.url) === wanted) || null;
}

// Открывает страницу hh.ru (в фоне, если её нет среди вкладок), читает разметку и закрывает вкладку за собой.
async function withHhPage(targetUrl, task) {
  const openTab = await findHhTab(targetUrl);
  let createdTabId = null;

  try {
    let tabId = openTab?.id;
    if (!tabId) {
      const created = await chrome.tabs.create({ url: targetUrl, active: false });
      createdTabId = created.id;
      tabId = createdTabId;
    }

    const info = await readPageInfo(tabId);
    if (!info) {
      return { ok: false, message: 'Не удалось прочитать страницу hh.ru. Проверьте, что ссылка открывается в браузере.' };
    }

    return await task(info);
  } finally {
    if (createdTabId != null) {
      chrome.tabs.remove(createdTabId).catch(() => {});
    }
  }
}

async function readPageInfo(tabId) {
  const deadline = Date.now() + PAGE_WAIT_MS;
  let best = null;

  while (Date.now() < deadline) {
    try {
      const [{ result } = {}] = await chrome.scripting.executeScript({
        target: { tabId },
        func: extractHhPage
      });

      if (result) {
        best = result;
        if (isPageReady(result)) return result;
      }
    } catch {
      // вкладка ещё грузится или недоступна — просто пробуем снова
    }
    await sleep(500);
  }

  return best;
}

// hh.ru дорисовывает страницы скриптами, поэтому ждём, пока появится имя, текст резюме или список резюме
const isPageReady = (info) =>
  Boolean(info.name) ||
  (info.resumes || []).length > 0 ||
  (info.isResume && String(info.text || '').length >= RESUME_MIN_LENGTH);

// Разбор страницы: либо резюме (текст), либо профиль (имя и ссылки на резюме).
// Функция выполняется в контексте вкладки, поэтому не должна ссылаться на внешние переменные.
function extractHhPage() {
  const clean = (value) =>
    String(value || '')
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter((line, index, all) => line && line !== all[index - 1])
      .join('\n');

  const PERSON_NAME = /^[А-ЯЁA-Z][а-яёa-z'’.-]+(?:\s+[А-ЯЁA-Z][а-яёa-z'’.-]+){1,2}$/;
  const RESUME_LINK = /\/resume\/([^/?#]+)/i;

  // разметка карточки резюме на странице профиля: ссылка и её название
  const RESUME_LINK_SELECTORS = ['a[data-qa="resume-card-link"]', 'a[href*="/resume/"]'];
  const RESUME_TITLE_SELECTORS = ['[data-qa="cell-text-content"]', '[data-qa*="resume-title"]'];

  const candidates = [];
  const addText = (value) => {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text) candidates.push(text);
  };

  const nameSelectors = [
    '[data-qa="profile-name"]',
    '[data-qa="applicant-name"]',
    '[data-qa*="name" i]',
    '[data-qa*="title" i]',
    'main h1',
    'h1',
    'h2'
  ];

  for (const selector of nameSelectors) {
    let nodes;
    try {
      nodes = document.querySelectorAll(selector);
    } catch {
      continue; // селектор с флагом i может не поддерживаться — пропускаем
    }
    for (const node of nodes) addText(node.innerText);
  }

  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle) addText(ogTitle.content);

  for (const part of String(document.title || '').split(/[—–|·]/)) addText(part);

  const name = candidates.find((text) => PERSON_NAME.test(text)) || '';

  // Ссылку на резюме берём из карточки, название — из её текстового узла.
  // Общий поиск по /resume/ остаётся запасным вариантом, но служебные адреса
  // вроде «создать резюме» (/resume/new) отсеиваются.
  const SERVICE_RESUME_ID = /^(new|create|edit|search|list|my|all)$/i;
  const MIN_RESUME_ID = 8;

  const titleFrom = (root) => {
    for (const selector of RESUME_TITLE_SELECTORS) {
      let node;
      try {
        node = root.querySelector(selector);
      } catch {
        continue;
      }
      const text = node ? clean(node.innerText) : '';
      if (text) return text.split('\n')[0];
    }
    return '';
  };

  const titleOf = (link) => {
    const own = titleFrom(link);
    if (own) return own;

    // название может лежать рядом со ссылкой, в той же карточке: поднимаемся вверх,
    // но не заходим в контейнер со списком резюме, чтобы не взять чужой заголовок
    let scope = link.parentElement;
    while (scope && scope !== document.body) {
      if (scope.querySelectorAll('a[href*="/resume/"]').length > 1) break;
      const near = titleFrom(scope);
      if (near) return near;
      scope = scope.parentElement;
    }

    return clean(link.innerText)
      .split('\n')
      .find((line) => line.length > 2) || '';
  };

  const found = new Map();

  const collect = (link, trusted) => {
    const match = String(link.href || '').match(RESUME_LINK);
    if (!match) return;

    const id = match[1];
    if (!trusted && (SERVICE_RESUME_ID.test(id) || id.length < MIN_RESUME_ID)) return;

    const existing = found.get(id);
    const title = titleOf(link);

    if (!existing) found.set(id, { url: `${link.origin}/resume/${id}`, title });
    else if (!existing.title && title) existing.title = title;
  };

  const cardLinks = [...document.querySelectorAll(RESUME_LINK_SELECTORS[0])];
  if (cardLinks.length) {
    for (const link of cardLinks) collect(link, true);
  } else {
    for (const link of document.querySelectorAll(RESUME_LINK_SELECTORS[1])) collect(link, false);
  }

  const container = document.querySelector('[data-qa="resume"]') || document.querySelector('main') || document.body;

  return {
    isResume: location.pathname.startsWith('/resume/'),
    name,
    resumes: [...found.values()].slice(0, 40),
    text: clean(container.innerText).slice(0, 12000)
  };
}

// Первый шаг: по ссылке из настроек понять, что это — резюме или профиль со списком резюме.
async function resolveSource() {
  const settings = await loadSettings();
  const parsed = parseSourceUrl(settings.resumeUrl);

  if (!parsed.ok) return { ok: false, message: parsed.reason };
  if (!parsed.url) {
    return { ok: false, message: 'Укажите ссылку на резюме или на страницу своего профиля hh.ru.' };
  }

  try {
    return await withHhPage(parsed.url, async (info) => {
      const name = normalizeFullName(info.name);
      const options = (info.resumes || []).filter((item) => item && item.url);

      if (info.isResume) {
        const text = String(info.text || '');
        if (text.length < RESUME_MIN_LENGTH) {
          return {
            ok: false,
            message:
              'Не удалось прочитать текст резюме. Проверьте, что ссылка открывается под вашим аккаунтом hh.ru и резюме опубликовано.'
          };
        }

        await saveSettings({
          resume: text,
          resumeUrl: parsed.url,
          selectedResumeUrl: parsed.url,
          // список, найденный ранее на странице профиля, не затираем пустым значением
          ...(options.length ? { resumeOptions: options } : {}),
          fullName: name || settings.fullName
        });

        return { ok: true, kind: 'resume', name, length: text.length, resume: text, resumes: options };
      }

      if (!options.length) {
        return {
          ok: false,
          message:
            'На странице не нашлось ссылок на резюме. Откройте свой профиль на hh.ru под своим аккаунтом или вставьте ссылку на конкретное резюме.'
        };
      }

      await saveSettings({ resumeUrl: parsed.url, resumeOptions: options, fullName: name || settings.fullName });
      return { ok: true, kind: 'list', name, resumes: options };
    });
  } catch (error) {
    return { ok: false, message: describeError(error) };
  }
}

// Второй шаг: разобрать конкретное резюме — выбранное в списке или указанное ссылкой.
async function refreshResume(explicitUrl) {
  const settings = await loadSettings();
  const source = String(explicitUrl || '').trim() || settings.selectedResumeUrl || settings.resumeUrl;
  const parsed = parseSourceUrl(source);

  if (!parsed.ok) return { ok: false, message: parsed.reason };
  if (!parsed.url) return { ok: false, message: 'Не выбрано резюме: укажите ссылку на резюме или на профиль.' };

  if (parsed.kind !== 'resume') {
    return {
      ok: false,
      message: 'Для разбора нужно конкретное резюме, а не страница профиля. Выберите резюме в списке настроек.'
    };
  }

  try {
    return await withHhPage(parsed.url, async (info) => {
      const text = String(info.text || '');
      if (text.length < RESUME_MIN_LENGTH) {
        return {
          ok: false,
          message:
            'Не удалось прочитать текст резюме. Проверьте, что ссылка открывается под вашим аккаунтом hh.ru и резюме опубликовано.'
        };
      }

      const name = normalizeFullName(info.name);
      await saveSettings({
        resume: text,
        selectedResumeUrl: parsed.url,
        fullName: name || settings.fullName
      });

      return { ok: true, message: `Резюме загружено: ${text.length} знаков.`, resume: text, name };
    });
  } catch (error) {
    return { ok: false, message: describeError(error) };
  }
}

async function streamCompletion({ settings, provider, messages, port, signal }) {
  const response = await request({ settings, provider, messages, stream: true, signal });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let buffer = '';
  let content = '';
  let reasoningLength = 0;
  let finishReason = null;
  let lastProgressAt = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';

    for (const chunk of chunks) {
      for (const event of readEvents(chunk, provider)) {
        if (event.reasoning) {
          reasoningLength += event.reasoning.length;
          const now = Date.now();
          if (now - lastProgressAt > 400) {
            lastProgressAt = now;
            port.postMessage({ type: 'reasoning', length: reasoningLength });
          }
        }
        if (event.content) {
          content += event.content;
          port.postMessage({ type: 'delta', text: event.content });
        }
        if (event.finishReason) finishReason = event.finishReason;
      }
    }
  }

  return { content, reasoningLength, finishReason };
}

function readEvents(chunk, provider) {
  const events = [];
  const reasoningFields = provider?.reasoningFields || ['reasoning_content', 'reasoning'];

  for (const line of chunk.split('\n')) {
    if (!line.startsWith('data:')) continue;

    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;

    let data;
    try {
      data = JSON.parse(payload);
    } catch {
      continue; // в SSE-потоке может прийти неполный JSON — такой фрагмент пропускаем
    }

    const choice = data.choices?.[0];
    if (!choice) continue;

    const delta = choice.delta || {};
    const reasoning = reasoningFields.map((field) => delta[field]).find((value) => typeof value === 'string') || '';

    events.push({
      content: typeof delta.content === 'string' ? delta.content : '',
      reasoning,
      finishReason: choice.finish_reason ?? null
    });
  }

  return events;
}

async function request({ settings, provider, messages, stream, signal }) {
  const apiKey = providerApiKey(settings);

  const headers = { 'Content-Type': 'application/json' };
  if (provider.requiresKey) headers.Authorization = `Bearer ${apiKey}`;

  const body = {
    model: providerModel(settings),
    messages,
    [provider.tokenParam]: resolveMaxTokens(settings),
    stream: Boolean(stream)
  };

  // часть моделей (reasoner, o-series, gpt-5) не принимает temperature
  if (provider.temperature && !isReasonerModel(settings.model)) {
    body.temperature = Number(settings.temperature) || 0.7;
  }

  const response = await fetch(providerEndpoint(provider), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal
  });

  if (!response.ok) throw new UserError(await httpErrorMessage(response, provider));
  return response;
}

async function httpErrorMessage(response, provider) {
  const name = provider?.label || 'Провайдер';

  let detail = '';
  try {
    const body = await response.json();
    detail = body?.error?.message || body?.message || '';
  } catch {
    // тело ответа может быть не JSON — тогда обходимся без деталей
  }

  const hints = {
    400: `${name} отклонил запрос (400)`,
    401: `${name} не принял API-ключ (401). Проверьте ключ в настройках`,
    402: `У ${name} закончились средства (402). Пополните баланс`,
    403: `${name} запретил запрос (403). Возможно, ключ без нужных прав`,
    404: `${name} не нашёл эндпоинт или модель (404). Проверьте название модели и адрес сервера`,
    422: `${name} не принял параметры запроса (422)`,
    429: `Слишком много запросов или исчерпана квота (429). Подождите или проверьте тариф`,
    500: `Внутренняя ошибка на стороне ${name} (500). Попробуйте позже`,
    503: `${name} перегружен (503). Попробуйте позже`
  };

  const hint = hints[response.status] || `${name} вернул ошибку ${response.status}`;
  return detail ? `${hint}: ${detail}` : hint;
}

function hostOf(baseUrl) {
  try {
    return new URL(baseUrl).host;
  } catch {
    return '';
  }
}

function describeError(error, context = null) {
  if (error instanceof UserError) return error.message;

  if (error instanceof TypeError) {
    const target = context?.host || 'сервером модели';
    return (
      `Не удалось связаться с ${target}. Проверьте интернет и адрес сервера; ` +
      'для своего сервера нужно разрешение доступа к домену в настройках расширения.'
    );
  }

  return `Ошибка: ${error?.message || String(error)}`;
}

async function testConnection() {
  let context = null;

  try {
    const settings = await loadSettings();
    const provider = resolveProvider(settings);
    context = { label: provider.label, host: hostOf(provider.baseUrl) };

    if (!provider.baseUrl) return { ok: false, message: 'Укажите адрес своего сервера в настройках.' };
    if (provider.requiresKey && !providerApiKey(settings)) return { ok: false, message: 'Сначала введите API-ключ.' };

    const response = await request({
      settings,
      provider,
      messages: [{ role: 'user', content: 'Ответь одним словом: работает' }],
      stream: false
    });
    const data = await response.json();

    return {
      ok: true,
      message: `Подключение работает: ${provider.label}, модель ${data?.model || providerModel(settings)}.`
    };
  } catch (error) {
    return { ok: false, message: describeError(error, context) };
  }
}

async function statusReport() {
  const settings = await loadSettings();
  const provider = resolveProvider(settings);
  const endpoint = provider.baseUrl ? providerEndpoint(provider) : '';

  return {
    ok: true,
    provider: provider.label,
    providerId: provider.id,
    host: hostOf(provider.baseUrl),
    endpoint,
    model: providerModel(settings),
    needsKey: provider.requiresKey,
    hasKey: !provider.requiresKey || Boolean(providerApiKey(settings)),
    hasResume: Boolean(settings.resume.trim() || settings.resumeUrl.trim()),
    hasResumeText: Boolean(settings.resume.trim()),
    fullName: settings.fullName || '',
    hasName: Boolean((settings.fullName || '').trim()),
    resumeOptions: Array.isArray(settings.resumeOptions) ? settings.resumeOptions.length : 0,
    selectedResumeUrl: settings.selectedResumeUrl || ''
  };
}
