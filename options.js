import {
  PROVIDERS,
  REASONER_MIN_TOKENS,
  isReasonerModel,
  loadSettings,
  normalizeBaseUrl,
  normalizeFullName,
  parseSourceUrl,
  resumeHash,
  resumeKey,
  resolveProvider,
  saveSettings
} from './lib.js';

const $ = (id) => document.getElementById(id);

const STALE_WORKER_HINT =
  'Фоновая часть расширения не ответила. Откройте chrome://extensions, нажмите ⟳ на карточке «HH Cover Letter» ' +
  'и перезагрузите эту страницу настроек.';

const LOOKS_LIKE_KEY = /^\S{16,}$/;

let settings = await loadSettings();

function setStatus(text, kind = '') {
  const status = $('status');
  status.textContent = text;
  status.className = `status ${kind}`.trim();
}

function setDiag(text, kind = '') {
  const diag = $('diag');
  diag.textContent = text;
  diag.className = `note ${kind}`.trim();
}

async function callBackground(message) {
  try {
    const result = await chrome.runtime.sendMessage(message);
    if (!result) return { ok: false, message: STALE_WORKER_HINT };
    return result;
  } catch (error) {
    return { ok: false, message: `${STALE_WORKER_HINT} (${error?.message || error})` };
  }
}

async function checkBackground() {
  const ping = await callBackground({ type: 'ping' });
  if (!ping?.ok) {
    setDiag(ping?.message || STALE_WORKER_HINT, 'error');
    return false;
  }

  const parts = [`Версия расширения ${ping.version}`];
  const status = await callBackground({ type: 'status' });

  if (status?.ok) {
    parts.push(`провайдер: ${status.provider}`);
    parts.push(status.endpoint ? `эндпоинт: ${status.endpoint}` : 'адрес сервера не задан');
    parts.push(status.needsKey ? (status.hasKey ? 'ключ задан' : 'ключ не задан') : 'ключ не требуется');
    parts.push(status.hasResumeText ? 'резюме загружено' : status.hasResume ? 'резюме по ссылке' : 'резюме не задано');
  }

  setDiag(`${parts.join('; ')}. Доступно: ${ping.features.join(', ')}.`);
  return true;
}

function providerFromForm() {
  return resolveProvider({ provider: $('provider').value, baseUrl: $('baseUrl').value });
}

function presetOf(id) {
  return PROVIDERS.find((item) => item.id === id) || PROVIDERS[0];
}

function fillProviderSelect() {
  $('provider').replaceChildren(
    ...PROVIDERS.map((preset) => {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = preset.label;
      return option;
    })
  );
}

function updateResumeLength() {
  $('resumeLength').textContent = String($('resume').value.trim().length);
}

function syncProviderUi() {
  const provider = providerFromForm();

  $('baseUrlBlock').hidden = provider.id !== 'custom';
  $('apiKeyLabel').textContent = provider.requiresKey
    ? `API-ключ ${provider.label}`
    : `API-ключ (${provider.label} не требует ключа)`;
  $('apiKey').disabled = !provider.requiresKey;
  $('toggleKey').disabled = !provider.requiresKey;

  const host = provider.baseUrl ? new URL(provider.baseUrl).host : '';
  $('keyNote').textContent = provider.requiresKey
    ? [
        `Ключ хранится локально в хранилище расширения и отправляется только на ${host}.`,
        provider.keyUrl ? `Создать ключ: ${provider.keyUrl}` : ''
      ]
        .filter(Boolean)
        .join(' ')
    : 'Этому провайдеру ключ не нужен: запрос идёт на ваш локальный сервер.';

  $('modelSuggestions').replaceChildren(
    ...provider.models.map((model) => {
      const option = document.createElement('option');
      option.value = model;
      return option;
    })
  );

  $('modelNote').textContent = provider.models.length
    ? 'Это подсказки типовых моделей — можно вписать любое своё название.'
    : 'Впишите название модели вашего сервера.';
}

function syncModelUi() {
  const provider = providerFromForm();
  const reasoner = isReasonerModel($('model').value);
  const temperatureSupported = provider.temperature && !reasoner;

  $('temperature').disabled = !temperatureSupported;
  $('temperatureNote').textContent = temperatureSupported
    ? '(меньше — стабильнее, больше — свободнее)'
    : reasoner
      ? '— эта модель не принимает temperature, значение не отправляется'
      : `— ${provider.label} не принимает temperature для этих моделей`;

  const floor = reasoner ? REASONER_MIN_TOKENS : 200;
  $('maxTokens').min = String(floor);
  if (reasoner && Number($('maxTokens').value) < floor) {
    $('maxTokens').value = String(floor);
  }

  $('tokenNote').textContent = reasoner
    ? `Лимит ограничивает и рассуждения, и текст письма, поэтому он поднят минимум до ${REASONER_MIN_TOKENS} ` +
      `(передаётся как ${provider.tokenParam}). Если ответ придёт пустым или оборванным — увеличьте значение.`
    : `Передаётся как ${provider.tokenParam}. При обрыве ответа увеличьте значение.`;
}

async function refreshPermissionNote() {
  const note = $('permissionNote');

  if ($('provider').value !== 'custom') {
    note.textContent = '';
    note.className = 'note';
    return;
  }

  const baseUrl = normalizeBaseUrl($('baseUrl').value);
  if (!baseUrl) {
    note.textContent = 'Укажите адрес сервера, затем разрешите доступ к домену.';
    note.className = 'note';
    return;
  }

  const { origin } = new URL(baseUrl);
  const granted = await chrome.permissions.contains({ origins: [`${origin}/*`] });

  note.textContent = granted
    ? `Доступ к ${origin} разрешён.`
    : `Нужно разрешить доступ к ${origin}: без этого запрос к своему серверу будет заблокирован.`;
  note.className = granted ? 'note ok' : 'note warn';
}

function apply(next) {
  fillProviderSelect();
  $('provider').value = next.provider;
  $('baseUrl').value = next.baseUrl || '';
  $('apiKey').value = next.apiKeys?.[next.provider] || '';
  $('model').value = next.model || '';
  $('temperature').value = String(next.temperature);
  $('temperatureValue').textContent = String(next.temperature);
  $('maxTokens').value = String(next.maxTokens);

  for (const id of ['tone', 'length', 'language', 'extra', 'resumeUrl', 'fullName']) {
    $(id).value = next[id] ?? '';
  }

  updateResumeLength();
  syncProviderUi();
  syncModelUi();
  refreshPermissionNote();
  renderResumePicker(next.resumes, next.selectedResumeUrl);
  showResumeContent(currentResumeUrl());
  syncNameNote();
}

const personName = () => normalizeFullName($('fullName').value);

// --- список резюме: у каждого свой текст ---------------------------------------

// Какое резюме показано в поле прямо сейчас. Обработчик change у выпадающего списка
// срабатывает уже после смены значения, поэтому сохранять текст нужно по этому адресу,
// а не по текущему значению списка, иначе правки уедут в чужое резюме.
let shownResumeUrl = '';

function currentResumeUrl() {
  return $('resumeChoice').value || settings.selectedResumeUrl || '';
}

function findEntry(url) {
  const wanted = resumeKey(url);
  if (!wanted) return null;
  return (settings.resumes || []).find((item) => resumeKey(item.url) === wanted) || null;
}

// Правки в поле сохраняются в то резюме, которое сейчас показано.
function stashResumeText() {
  const wanted = resumeKey(shownResumeUrl);
  if (!wanted) return;

  settings = {
    ...settings,
    resumes: (settings.resumes || []).map((item) =>
      resumeKey(item.url) === wanted ? { ...item, text: $('resume').value } : item
    )
  };
}

function resumeStateNote(entry) {
  const note = $('resumeState');

  if (!entry) {
    note.textContent = '';
    note.className = 'note';
    return;
  }

  if (entry.text?.trim()) {
    note.textContent = `Текст прочитан: ${entry.text.trim().length} знаков.`;
    note.className = 'note ok';
    return;
  }

  note.textContent = entry.error
    ? `Не прочитано: ${entry.error}. Можно вставить текст вручную.`
    : 'Текст не прочитан. Нажмите «Перечитать» или вставьте текст вручную.';
  note.className = 'note warn';
}

function showResumeContent(url) {
  shownResumeUrl = url || '';
  const entry = findEntry(shownResumeUrl);
  $('resume').value = entry ? String(entry.text || '') : '';
  $('resumeLabel').textContent = entry?.title ? `Текст резюме «${entry.title}»` : 'Текст резюме';
  updateResumeLength();
  resumeStateNote(entry);
}

function renderResumePicker(list, selectedUrl) {
  const picker = $('resumePicker');
  const select = $('resumeChoice');
  const items = Array.isArray(list) ? list.filter((item) => item && item.url) : [];

  if (!items.length) {
    picker.hidden = true;
    select.replaceChildren();
    showResumeContent('');
    return;
  }

  const previous = select.value;
  const has = (url) => items.some((item) => resumeKey(item.url) === resumeKey(url));

  select.replaceChildren(
    ...items.map((item) => {
      const option = document.createElement('option');
      option.value = item.url;
      const title = item.title || `Резюме ${resumeHash(item.url).slice(0, 8)}`;
      option.textContent = item.hasText ? title : `${title} — не прочитано`;
      return option;
    })
  );

  // выбор пользователя важнее значения из настроек: иначе после «Перечитать» список
  // вернулся бы к резюме по умолчанию и поле показало бы чужой текст
  select.value = has(previous) ? previous : has(selectedUrl) ? selectedUrl : items[0].url;
  picker.hidden = false;
}

// Читает все резюме из списка, показывая прогресс.
function parseAllResumes({ force = false } = {}) {
  return new Promise((resolve) => {
    let port;
    try {
      port = chrome.runtime.connect({ name: 'resumes' });
    } catch {
      resolve({ ok: false, message: STALE_WORKER_HINT });
      return;
    }

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try {
        port.disconnect();
      } catch {
        // порт уже закрыт
      }
      resolve(result);
    };

    port.onMessage.addListener((msg) => {
      if (msg.type === 'progress') {
        const label = msg.title ? `«${msg.title}»` : 'резюме';
        setStatus(
          msg.current ? `Читаю ${label}: ${msg.done} из ${msg.total}…` : `Готово: ${msg.done} из ${msg.total}.`,
          msg.error ? 'warn' : ''
        );
      } else if (msg.type === 'done') {
        finish(msg);
      } else if (msg.type === 'error') {
        finish({ ok: false, message: msg.message });
      }
    });

    port.onDisconnect.addListener(() => finish({ ok: false, message: STALE_WORKER_HINT }));

    port.postMessage({ type: 'parse', force });
  });
}

async function syncResumeStateAfterParse() {
  settings = await loadSettings();
  renderResumePicker(settings.resumes, settings.selectedResumeUrl);
  showResumeContent(currentResumeUrl());
}

function syncNameNote() {
  const name = personName();
  const note = $('nameNote');

  if (name) {
    note.textContent = `Имя «${name}» попадёт в подпись письма: подставлять вручную ничего не придётся.`;
    note.className = 'note ok';
    return;
  }

  note.textContent =
    'Имя не задано. Если его нет и в тексте резюме, модель подпишет письмо без имени — заглушек вида «[Ваше имя]» она не оставит.';
  note.className = 'note warn';
}

function collect() {
  return {
    provider: $('provider').value,
    baseUrl: $('baseUrl').value.trim(),
    model: $('model').value.trim(),
    temperature: Number($('temperature').value),
    maxTokens: Number($('maxTokens').value),
    tone: $('tone').value,
    length: $('length').value,
    language: $('language').value,
    extra: $('extra').value,
    resumeUrl: $('resumeUrl').value.trim(),
    fullName: normalizeFullName($('fullName').value)
  };
}

async function persist({ silent = false } = {}) {
  const values = collect();
  const providerId = values.provider;
  const preset = presetOf(providerId);
  let notice = null;

  const parsedUrl = parseSourceUrl(values.resumeUrl);
  if (parsedUrl.ok) {
    values.resumeUrl = parsedUrl.url;
    $('resumeUrl').value = parsedUrl.url;
  } else {
    values.resumeUrl = settings.resumeUrl;
    $('resumeUrl').value = settings.resumeUrl;
    notice = { text: `Ссылка на резюме не сохранена: ${parsedUrl.reason}`, kind: 'error' };
  }

  if (preset.id === 'custom') {
    const baseUrl = normalizeBaseUrl(values.baseUrl);
    if (baseUrl) {
      values.baseUrl = baseUrl;
      $('baseUrl').value = baseUrl;
    } else {
      values.baseUrl = settings.baseUrl;
      notice = notice || {
        text: 'Адрес своего сервера не сохранён: нужен http(s)-адрес вида https://host/v1',
        kind: 'error'
      };
    }
  } else {
    values.baseUrl = settings.baseUrl;
  }

  if (!values.model) {
    values.model = settings.model;
    $('model').value = settings.model;
    notice = notice || { text: 'Название модели не может быть пустым.', kind: 'error' };
  }

  const apiKey = $('apiKey').value.trim();

  // текст из поля относится к выбранному резюме и сохраняется вместе с ним
  stashResumeText();

  const next = {
    ...settings,
    ...values,
    resumes: settings.resumes,
    selectedResumeUrl: currentResumeUrl() || settings.selectedResumeUrl,
    apiKeys: { ...settings.apiKeys, [providerId]: apiKey },
    modelsByProvider: { ...settings.modelsByProvider, [providerId]: values.model }
  };

  settings = next;
  await saveSettings(next);
  updateResumeLength();

  if (silent) return next;

  if (notice) {
    setStatus(notice.text, notice.kind);
  } else if (apiKey && preset.requiresKey !== false && !LOOKS_LIKE_KEY.test(apiKey)) {
    setStatus('Сохранено, но ключ выглядит необычно — проверьте, что он скопирован целиком.', 'warn');
  } else {
    setStatus('Сохранено.', 'ok');
  }

  return next;
}

$('provider').addEventListener('change', async () => {
  const previousId = settings.provider;

  settings.apiKeys = { ...settings.apiKeys, [previousId]: $('apiKey').value.trim() };
  settings.modelsByProvider = { ...settings.modelsByProvider, [previousId]: $('model').value.trim() };

  const providerId = $('provider').value;
  const preset = presetOf(providerId);
  settings.provider = providerId;
  settings.model = settings.modelsByProvider[providerId] || preset.models[0] || '';

  $('apiKey').value = settings.apiKeys[providerId] || '';
  $('model').value = settings.model;

  syncProviderUi();
  syncModelUi();
  await persist({ silent: true });
  await refreshPermissionNote();
  setStatus(`Провайдер: ${providerFromForm().label}. Проверьте ключ и название модели.`);
});

$('baseUrl').addEventListener('change', refreshPermissionNote);
$('model').addEventListener('input', syncModelUi);

$('temperature').addEventListener('input', () => {
  $('temperatureValue').textContent = $('temperature').value;
});

$('resume').addEventListener('input', updateResumeLength);

$('toggleKey').addEventListener('click', () => {
  const field = $('apiKey');
  const hidden = field.type === 'password';
  field.type = hidden ? 'text' : 'password';
  $('toggleKey').textContent = hidden ? 'Скрыть' : 'Показать';
});

$('grantAccess').addEventListener('click', async () => {
  const baseUrl = normalizeBaseUrl($('baseUrl').value);
  if (!baseUrl) {
    setStatus('Сначала укажите адрес сервера.', 'error');
    return;
  }

  const { origin } = new URL(baseUrl);

  try {
    const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
    await refreshPermissionNote();
    setStatus(
      granted
        ? `Доступ к ${origin} разрешён.`
        : 'В разрешении отказано — запросы к этому серверу будут заблокированы браузером.',
      granted ? 'ok' : 'warn'
    );
  } catch (error) {
    setStatus(`Не удалось запросить разрешение: ${error?.message || error}`, 'error');
  }
});

$('save').addEventListener('click', () => persist());

$('clearResume').addEventListener('click', async () => {
  $('resume').value = '';
  updateResumeLength();
  stashResumeText();
  await persist({ silent: true });
  showResumeContent(currentResumeUrl());
  setStatus('Текст выбранного резюме очищен — впишите нужный или нажмите «Перечитать».', 'warn');
});

$('test').addEventListener('click', async () => {
  setStatus('Проверяю подключение…');
  await persist({ silent: true });

  const result = await callBackground({ type: 'test-connection' });
  setStatus(result?.message || STALE_WORKER_HINT, result?.ok ? 'ok' : 'error');
  await checkBackground();
});

$('loadResume').addEventListener('click', async () => {
  const parsed = parseSourceUrl($('resumeUrl').value);
  if (!parsed.ok) {
    setStatus(parsed.reason, 'error');
    return;
  }

  setStatus('Читаю страницу hh.ru…');
  await persist({ silent: true });

  const result = await callBackground({ type: 'resolve-source' });
  await checkBackground();

  if (!result?.ok) {
    setStatus(result?.message || STALE_WORKER_HINT, 'error');
    return;
  }

  if (result.name) {
    $('fullName').value = result.name;
    syncNameNote();
  }

  settings = await loadSettings();

  // по умолчанию берём первое резюме, чтобы список не остался без выбора
  if (!settings.selectedResumeUrl && settings.resumes.length) {
    settings = await saveSettings({ selectedResumeUrl: settings.resumes[0].url });
  }

  renderResumePicker(settings.resumes, settings.selectedResumeUrl);
  showResumeContent(currentResumeUrl());
  await persist({ silent: true });

  const nameInfo = result.name
    ? ` Имя из профиля: ${result.name}.`
    : ' Имя на странице не нашлось — впишите его в поле «Имя и фамилия для подписи».';
  setStatus(`Найдено резюме: ${settings.resumes.length}.${nameInfo}`, result.name ? 'ok' : 'warn');

  // читаем текст всех резюме сразу, чтобы при выборе он был на месте
  const bulk = await parseAllResumes();
  await syncResumeStateAfterParse();

  if (!bulk.ok) {
    setStatus(bulk.message || STALE_WORKER_HINT, 'error');
    return;
  }

  const unread = (await loadSettings()).resumes.filter((item) => !String(item.text || '').trim()).length;
  setStatus(
    unread
      ? `Резюме: ${bulk.parsed} из ${bulk.total} прочитано, ${unread} без текста — нажмите «Перечитать» или вставьте текст вручную.`
      : `Готово: прочитано резюме ${bulk.parsed} из ${bulk.total}. Выберите, какое подставлять по умолчанию.`,
    unread ? 'warn' : 'ok'
  );
});

$('resumeChoice').addEventListener('change', async () => {
  await persist({ silent: true });
  showResumeContent($('resumeChoice').value);
  setStatus('Выбрано резюме по умолчанию. Для конкретной вакансии его можно сменить в панели на странице.', 'ok');
});

$('reloadResume').addEventListener('click', async () => {
  const url = currentResumeUrl();
  if (!url) return;

  setStatus('Перечитываю резюме…');
  stashResumeText();
  await persist({ silent: true });

  const result = await callBackground({ type: 'refresh-resume', url });
  if (!result?.ok) {
    setStatus(result?.message || STALE_WORKER_HINT, 'error');
  } else {
    setStatus(result.message, 'ok');
  }

  await syncResumeStateAfterParse();
});

$('reloadAllResumes').addEventListener('click', async () => {
  setStatus('Перечитываю все резюме…');
  stashResumeText();
  await persist({ silent: true });

  const bulk = await parseAllResumes({ force: true });
  await syncResumeStateAfterParse();

  setStatus(
    bulk.ok
      ? `Перечитано резюме: ${bulk.parsed} из ${bulk.total}${bulk.failed ? `, ошибок: ${bulk.failed}` : ''}.`
      : bulk.message || STALE_WORKER_HINT,
    bulk.ok ? 'ok' : 'error'
  );
});

$('fullName').addEventListener('input', syncNameNote);

$('reloadExtension').addEventListener('click', () => chrome.runtime.reload());

apply(settings);
await checkBackground();
