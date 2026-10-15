import {
  buildMessages,
  isReasonerModel,
  loadSettings,
  parseResumeUrl,
  providerApiKey,
  providerEndpoint,
  providerModel,
  resolveMaxTokens,
  resolveProvider,
  resumeKey,
  saveSettings
} from './lib.js';

const RESUME_PATH = '/resume/';
const RESUME_MIN_LENGTH = 100;
const RESUME_WAIT_MS = 15000;

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
      if (!settings.resume.trim() && settings.resumeUrl.trim()) {
        const refreshed = await refreshResume();
        if (signal.aborted) return;
        if (refreshed.ok) settings = await loadSettings();
      }
      if (!settings.resume.trim()) {
        throw new UserError(
          'Не заполнено резюме — откройте настройки расширения и укажите ссылку на резюме или вставьте его текст.'
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
    features: ['refresh-resume', 'test-connection', 'status']
  }),
  status: () => statusReport(),
  'test-connection': () => testConnection(),
  'refresh-resume': () => refreshResume()
};

const HANDLED_MESSAGES = Object.keys(MESSAGE_HANDLERS);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = MESSAGE_HANDLERS[msg?.type];
  if (!handler) return undefined;

  Promise.resolve()
    .then(handler)
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

async function findResumeTab(targetUrl) {
  const tabs = await chrome.tabs.query({});
  const wanted = resumeKey(targetUrl);

  if (wanted) {
    const exact = tabs.find((tab) => tab.id && resumeKey(tab.url) === wanted);
    if (exact) return exact;
  }

  return (
    tabs.find((tab) => {
      if (!tab.id || !tab.url) return false;
      try {
        const url = new URL(tab.url);
        return /(^|\.)hh\.ru$/i.test(url.hostname) && url.pathname.startsWith(RESUME_PATH);
      } catch {
        return false;
      }
    }) || null
  );
}

async function refreshResume() {
  const settings = await loadSettings();
  const parsed = parseResumeUrl(settings.resumeUrl);
  if (!parsed.ok) return { ok: false, message: parsed.reason };

  const openTab = await findResumeTab(parsed.url);
  const tabUrl = parsed.url || openTab?.url;

  if (!tabUrl) {
    return {
      ok: false,
      message: 'Укажите ссылку на резюме hh.ru в настройках или откройте страницу резюме в отдельной вкладке.'
    };
  }

  let createdTabId = null;

  try {
    let tabId = openTab?.id;
    if (!tabId) {
      const created = await chrome.tabs.create({ url: tabUrl, active: false });
      createdTabId = created.id;
      tabId = createdTabId;
    }

    const text = await readResumeFromTab(tabId);
    if (text.length < RESUME_MIN_LENGTH) {
      return {
        ok: false,
        message:
          'Не удалось прочитать текст резюме. Проверьте, что ссылка открывается под вашим аккаунтом hh.ru и резюме опубликовано.'
      };
    }

    await saveSettings({ resume: text, resumeUrl: tabUrl });
    return { ok: true, message: `Резюме загружено: ${text.length} знаков.`, resume: text };
  } catch (error) {
    return { ok: false, message: describeError(error) };
  } finally {
    if (createdTabId != null) {
      chrome.tabs.remove(createdTabId).catch(() => {});
    }
  }
}

async function readResumeFromTab(tabId) {
  const deadline = Date.now() + RESUME_WAIT_MS;
  let best = '';

  while (Date.now() < deadline) {
    try {
      const [{ result } = {}] = await chrome.scripting.executeScript({
        target: { tabId },
        func: extractResumeText
      });
      if (typeof result === 'string' && result.length > best.length) best = result;
      if (best.length >= RESUME_MIN_LENGTH) return best;
    } catch {
      // вкладка ещё грузится или недоступна — просто пробуем снова
    }
    await sleep(500);
  }

  return best;
}

function extractResumeText() {
  const clean = (value) =>
    String(value || '')
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter((line, index, all) => line && line !== all[index - 1])
      .join('\n');

  const container =
    document.querySelector('[data-qa="resume"]') || document.querySelector('main') || document.body;

  return clean(container.innerText).slice(0, 12000);
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
    hasResumeText: Boolean(settings.resume.trim())
  };
}
