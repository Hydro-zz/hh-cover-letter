(() => {
  const HOST_ID = 'hh-cover-letter-root';
  const PORT_NAME = 'llm';
  const MIN_DESCRIPTION = 120;
  const COLLAPSED_KEY = 'panelCollapsed';

  const SELECTORS = {
    title: ['[data-qa="vacancy-title"]', 'h1[data-qa]', 'h1'],
    company: [
      '[data-qa="vacancy-company-name"]',
      '[data-qa="vacancy-company-name-link"]',
      '[data-qa="vacancy-company"]'
    ],
    salary: ['[data-qa="vacancy-salary"]'],
    location: ['[data-qa="vacancy-view-location"]', '[data-qa="vacancy-view-raw-address"]'],
    employment: ['[data-qa="vacancy-view-employment-mode"]', '[data-qa="vacancy-view-experience"]'],
    description: ['[data-qa="vacancy-description"]', '[data-qa="vacancy-description-content"]'],
    skills: ['[data-qa="skills-element"]', '[data-qa="vacancy-skill"]'],
    responseLinks: [
      '[data-qa="vacancy-response-link-top"]',
      '[data-qa="vacancy-response-link-bottom"]',
      '[data-qa*="vacancy-response-link"]'
    ],
    letterToggle: [
      '[data-qa="vacancy-response-letter-toggle"]',
      '[data-qa="vacancy-response-letter-link"]',
      '[data-qa*="letter-toggle"]'
    ],
    letterField: [
      'textarea[data-qa="vacancy-response-popup-form-letter-input"]',
      'textarea[data-qa*="letter"]',
      'textarea[name="text"]',
      'textarea'
    ]
  };

  const RESPONSE_CONTAINERS = [
    '[data-qa*="response"]',
    '[data-qa*="popup"]',
    '[role="dialog"]',
    '[class*="modal"]',
    '[class*="Modal"]'
  ];

  const isChatField = (el) => Boolean(el.closest('[data-qa*="chat"], [data-qa*="negotiation"]'));

  let ui = null;
  let port = null;
  let busy = false;
  let collapsed = true;

  const isVacancyPage = () =>
    /(^|\.)hh\.ru$/.test(location.hostname) && location.pathname.startsWith('/vacancy/');

  const isVisible = (el) => {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    return getComputedStyle(el).visibility !== 'hidden';
  };

  const cleanText = (value) =>
    String(value || '')
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter((line, index, all) => line && line !== all[index - 1])
      .join('\n');

  const firstVisible = (selectors, root = document) => {
    for (const selector of selectors) {
      const nodes = [...root.querySelectorAll(selector)];
      const found = nodes.find(isVisible) || nodes[0];
      if (found) return found;
    }
    return null;
  };

  const textOf = (selectors) => {
    const el = firstVisible(selectors);
    return el ? cleanText(el.innerText) : '';
  };

  function extractVacancy() {
    const skills = [...document.querySelectorAll(SELECTORS.skills.join(','))]
      .map((el) => cleanText(el.innerText))
      .filter(Boolean);

    const descriptionParts = [textOf(SELECTORS.description)];
    if (skills.length) descriptionParts.push(`Ключевые навыки: ${skills.join(', ')}`);

    return {
      url: location.href.split('?')[0],
      title: textOf(SELECTORS.title),
      company: textOf(SELECTORS.company),
      salary: textOf(SELECTORS.salary),
      location: textOf(SELECTORS.location),
      employment: textOf(SELECTORS.employment),
      description: cleanText(descriptionParts.filter(Boolean).join('\n\n'))
    };
  }

  function pickLetterField() {
    for (const container of document.querySelectorAll(RESPONSE_CONTAINERS.join(','))) {
      if (!isVisible(container)) continue;
      const field = firstVisible(SELECTORS.letterField, container);
      if (field && isVisible(field) && !isChatField(field)) return field;
    }

    const fallback = firstVisible(SELECTORS.letterField);
    return fallback && isVisible(fallback) && !isChatField(fallback) ? fallback : null;
  }

  async function waitForLetterField(timeout) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const field = pickLetterField();
      if (field) return field;
      await sleep(200);
    }
    return null;
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function clickFirst(selectors) {
    const el = firstVisible(selectors);
    if (!el) return false;
    el.click();
    return true;
  }

  function setNativeValue(field, value) {
    const proto =
      field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }

  const STYLES = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .panel, .launcher { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
    .panel {
      position: fixed; right: 16px; bottom: 16px; width: 380px; max-width: calc(100vw - 32px);
      z-index: 2147483000; background: #1f2023; color: #ecedef; border-radius: 12px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, .35); overflow: hidden;
    }
    .panel[hidden], .launcher[hidden] { display: none; }
    header {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      padding: 10px 12px; background: #d6001c; color: #fff; font-size: 13px; font-weight: 600;
    }
    header button {
      border: 0; background: rgba(255, 255, 255, .18); color: #fff; border-radius: 6px;
      width: 24px; height: 24px; cursor: pointer; font-size: 14px; line-height: 1;
    }
    .body { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
    .vacancy { font-size: 12px; color: #a8adb7; line-height: 1.45; max-height: 48px; overflow: hidden; }
    .warn { color: #ffb547; }
    textarea {
      width: 100%; min-height: 190px; max-height: 45vh; resize: vertical; padding: 10px;
      border-radius: 8px; border: 1px solid #3a3d43; background: #17181a; color: #ecedef;
      font-size: 13px; line-height: 1.5; font-family: inherit;
    }
    textarea:focus { outline: none; border-color: #d6001c; }
    .status { font-size: 12px; line-height: 1.4; min-height: 16px; color: #a8adb7; }
    .status.ok { color: #62d26f; }
    .status.error { color: #ff6b6b; }
    .status.warn { color: #ffb547; }
    .row { display: flex; gap: 8px; }
    .resumeRow { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #a8adb7; }
    .resumeRow[hidden] { display: none; }
    .resumeRow label { flex: none; }
    .resumeRow select {
      flex: 1; min-width: 0; padding: 6px 8px; border-radius: 6px; border: 1px solid #3a3d43;
      background: #17181a; color: #ecedef; font-size: 12px; font-family: inherit;
    }
    .resumeRow select:focus { outline: none; border-color: #d6001c; }
    button {
      flex: 1; padding: 8px 10px; border-radius: 8px; border: 1px solid #3a3d43; background: #26282c;
      color: #ecedef; font-size: 12px; font-family: inherit; cursor: pointer;
    }
    button:hover:not(:disabled) { background: #303339; }
    button.primary { background: #d6001c; border-color: #d6001c; font-weight: 600; }
    button.primary:hover:not(:disabled) { background: #ec1c33; }
    button:disabled { opacity: .45; cursor: default; }
    .launcher {
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483000; display: flex;
      align-items: center; gap: 8px; padding: 10px 14px; border: 0; border-radius: 24px;
      background: #d6001c; color: #fff; font-size: 13px; font-weight: 600; cursor: pointer;
      box-shadow: 0 8px 24px rgba(214, 0, 28, .4);
    }
    .launcher[hidden] { display: none; }
  `;

  function mount() {
    if (ui) return ui;

    const host = document.createElement('div');
    host.id = HOST_ID;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>${STYLES}</style>
      <button class="launcher" type="button">✍ Письмо под вакансию</button>
      <section class="panel" hidden>
        <header>
          <span>Письмо под вакансию</span>
          <button class="collapse" type="button" title="Свернуть">–</button>
        </header>
        <div class="body">
          <div class="vacancy"></div>
          <div class="resumeRow" hidden>
            <label>Резюме</label>
            <select class="resume"></select>
          </div>
          <textarea placeholder="Здесь появится письмо. Можно править текст прямо здесь."></textarea>
          <div class="status"></div>
          <div class="row">
            <button class="generate primary" type="button">Сгенерировать</button>
            <button class="insert" type="button" disabled>Вставить в отклик</button>
          </div>
          <div class="row">
            <button class="copy" type="button">Копировать</button>
            <button class="options" type="button">Настройки</button>
          </div>
        </div>
      </section>
    `;

    document.documentElement.appendChild(host);

    const els = {
      host,
      shadow,
      launcher: shadow.querySelector('.launcher'),
      panel: shadow.querySelector('.panel'),
      vacancy: shadow.querySelector('.vacancy'),
      resumeRow: shadow.querySelector('.resumeRow'),
      resumeSelect: shadow.querySelector('.resumeRow select'),
      letter: shadow.querySelector('textarea'),
      status: shadow.querySelector('.status'),
      generate: shadow.querySelector('.generate'),
      insert: shadow.querySelector('.insert'),
      copy: shadow.querySelector('.copy'),
      options: shadow.querySelector('.options'),
      collapse: shadow.querySelector('.collapse')
    };

    els.launcher.addEventListener('click', () => setCollapsed(false));
    els.collapse.addEventListener('click', () => setCollapsed(true));
    els.generate.addEventListener('click', generate);
    els.insert.addEventListener('click', insertIntoResponse);
    els.copy.addEventListener('click', copyLetter);
    els.options.addEventListener('click', () => chrome.runtime.openOptionsPage());
    els.resumeSelect.addEventListener('change', () => chooseResume(els.resumeSelect.value));
    els.letter.addEventListener('input', () => {
      if (busy) return;
      els.insert.disabled = !els.letter.value.trim();
      els.generate.textContent = els.letter.value.trim() ? 'Перегенерировать' : 'Сгенерировать';
    });

    ui = els;
    return ui;
  }

  function setCollapsed(next) {
    collapsed = next;
    chrome.storage.local.set({ [COLLAPSED_KEY]: next });
    applyCollapsed();
  }

  function applyCollapsed() {
    if (!ui) return;
    ui.panel.hidden = collapsed;
    ui.launcher.hidden = !collapsed;
  }

  function setStatus(text, kind = 'info') {
    if (!ui) return;
    ui.status.textContent = text;
    ui.status.className = `status ${kind === 'info' ? '' : kind}`.trim();
  }

  function setBusy(next) {
    busy = next;
    if (!ui) return;
    ui.generate.disabled = next;
    ui.generate.textContent = next ? 'Генерирую…' : ui.letter.value.trim() ? 'Перегенерировать' : 'Сгенерировать';
    ui.insert.disabled = next || !ui.letter.value.trim();
  }

  async function fetchStatus() {
    try {
      const status = await chrome.runtime.sendMessage({ type: 'status' });
      return status?.ok ? status : null;
    } catch {
      return null;
    }
  }

  const trimUrl = (value) => String(value || '').replace(/[?#].*$/, '');

  function findResumeEntry(status, url) {
    const wanted = trimUrl(url);
    if (!wanted) return null;
    return (status?.resumes || []).find((item) => trimUrl(item.url) === wanted) || null;
  }

  function defaultResumeUrl(status) {
    const fromVacancy = (status?.resumeByVacancy || {})[extractVacancy().url];
    if (fromVacancy && findResumeEntry(status, fromVacancy)) return fromVacancy;
    if (status?.selectedResumeUrl && findResumeEntry(status, status.selectedResumeUrl)) return status.selectedResumeUrl;
    return status?.resumes?.[0]?.url || '';
  }

  const currentResumeUrl = () => ui?.resumeSelect.value || '';

  // Если в настройках загружено несколько резюме, для конкретной вакансии можно взять другое.
  function syncResumeSelect(status) {
    if (!ui) return;

    const list = status?.resumes || [];
    if (!list.length) {
      ui.resumeRow.hidden = true;
      ui.resumeSelect.replaceChildren();
      return;
    }

    const previous = ui.resumeSelect.value;

    ui.resumeSelect.replaceChildren(
      ...list.map((item) => {
        const option = document.createElement('option');
        option.value = item.url;
        const title = item.title || `Резюме ${(item.url.split('/resume/')[1] || '').slice(0, 8)}`;
        option.textContent = item.hasText ? title : `${title} — не прочитано`;
        return option;
      })
    );

    ui.resumeSelect.value = findResumeEntry(status, previous) ? previous : defaultResumeUrl(status);
    ui.resumeRow.hidden = false;
  }

  async function chooseResume(url) {
    if (!url || !ui) return;

    try {
      await chrome.runtime.sendMessage({
        type: 'set-vacancy-resume',
        vacancyUrl: extractVacancy().url,
        resumeUrl: url
      });
    } catch {
      // фоновая часть недоступна: выбор всё равно применится к текущей генерации
    }

    const label = ui.resumeSelect.selectedOptions[0]?.textContent || url;
    setStatus(`Для этой вакансии выбрано резюме: ${label}`, 'info');
    await refreshHint();
  }

  async function refreshHint() {
    if (!ui) return;
    const status = await fetchStatus();
    const vacancy = extractVacancy();

    const lines = [];
    const heading = [vacancy.title, vacancy.company].filter(Boolean).join(' · ');
    if (heading) lines.push({ text: heading });

    const warnings = [];
    if (vacancy.description.length < MIN_DESCRIPTION) warnings.push('текст вакансии не прочитан');
    if (status && !status.hasKey) warnings.push(`нет API-ключа ${status.provider}`);
    for (const warning of warnings) lines.push({ text: `⚠ ${warning}`, warn: true });

    syncResumeSelect(status);

    if (!status) {
      lines.push({ text: '⚠ фоновая часть расширения не отвечает', warn: true });
    } else if (!status.resumes?.length) {
      lines.push({ text: '⚠ нет резюме: загрузите профиль в настройках', warn: true });
    } else {
      const entry = findResumeEntry(status, currentResumeUrl());
      if (entry && !entry.hasText) {
        lines.push({ text: '⚠ текст выбранного резюме не прочитан', warn: true });
      }
    }

    if (status && status.hasName) {
      lines.push({ text: `подпись: ${status.fullName}` });
    } else if (status) {
      lines.push({ text: '⚠ имя для подписи не задано', warn: true });
    }

    if (status?.model) {
      lines.push({ text: `${status.provider}: ${status.model}` });
    }

    ui.vacancy.replaceChildren(
      ...lines.map(({ text, warn }) => {
        const line = document.createElement('div');
        line.textContent = text;
        if (warn) line.className = 'warn';
        return line;
      })
    );
  }

  function abortStream() {
    if (!port) return;
    const current = port;
    port = null;
    try {
      current.disconnect();
    } catch {
      // порт уже закрыт — ничего страшного
    }
  }

  async function generate() {
    if (busy || !ui) return;

    const status = await fetchStatus();

    if (!status) {
      setStatus('Фоновая часть расширения не отвечает. Перезагрузите расширение в chrome://extensions.', 'error');
      return;
    }
    if (!status.hasKey) {
      setStatus(`Не задан API-ключ ${status.provider}. Откройте «Настройки» и вставьте ключ.`, 'error');
      return;
    }
    if (!status.model) {
      setStatus('Не указана модель. Откройте «Настройки» и выберите модель.', 'error');
      return;
    }
    if (!status.resumes?.length) {
      setStatus('Резюме не загружены. Откройте «Настройки» и загрузите страницу профиля hh.ru.', 'error');
      return;
    }

    const vacancy = extractVacancy();
    const resumeUrl = currentResumeUrl() || defaultResumeUrl(status);
    const entry = findResumeEntry(status, resumeUrl);

    if (entry && !entry.hasText) {
      setStatus('Текст выбранного резюме не прочитан — читаю его и генерирую письмо…', 'info');
    } else if (vacancy.description.length < MIN_DESCRIPTION) {
      setStatus('Не удалось прочитать текст вакансии — письмо получится менее точным.', 'warn');
    } else {
      setStatus('Генерирую письмо…', 'info');
    }

    ui.letter.value = '';
    setBusy(true);

    port = chrome.runtime.connect({ name: PORT_NAME });
    const current = port;

    current.onMessage.addListener((msg) => {
      if (port !== current) return;
      if (msg.type === 'delta') {
        ui.letter.value += msg.text;
        ui.letter.scrollTop = ui.letter.scrollHeight;
      } else if (msg.type === 'reasoning') {
        setStatus(`Модель рассуждает… (${msg.length} знаков размышлений, письмо появится после них)`, 'info');
      } else if (msg.type === 'done') {
        finishStream();
        const length = ui.letter.value.trim().length;
        if (msg.finishReason === 'length') {
          setStatus(
            `Готово: ${length} знаков, но ответ оборван лимитом токенов — проверьте конец письма или увеличьте лимит в настройках.`,
            'warn'
          );
        } else {
          setStatus(`Готово: ${length} знаков. Проверьте текст и отправьте отклик сами.`, 'ok');
        }
      } else if (msg.type === 'error') {
        finishStream();
        setStatus(msg.message, 'error');
      }
    });

    current.onDisconnect.addListener(() => {
      if (port === current) port = null;
      if (busy) finishStream();
    });

    current.postMessage({ type: 'generate', vacancy, resumeUrl });
  }

  function finishStream() {
    setBusy(false);
    if (ui) ui.generate.textContent = ui.letter.value.trim() ? 'Перегенерировать' : 'Сгенерировать';
  }

  async function copyLetter() {
    const letter = ui?.letter.value.trim();
    if (!letter) {
      setStatus('Сначала сгенерируйте письмо.', 'warn');
      return;
    }
    try {
      await navigator.clipboard.writeText(letter);
      setStatus('Письмо скопировано в буфер обмена.', 'ok');
    } catch {
      ui.letter.select();
      setStatus('Не удалось скопировать автоматически — текст выделен, нажмите Ctrl+C.', 'warn');
    }
  }

  async function insertIntoResponse() {
    if (!ui) return;
    const letter = ui.letter.value.trim();
    if (!letter) {
      setStatus('Сначала сгенерируйте письмо.', 'warn');
      return;
    }

    let field = pickLetterField();
    if (!field) {
      setStatus('Открываю форму отклика…', 'info');
      const opened = clickFirst(SELECTORS.responseLinks);
      field = await waitForLetterField(opened ? 6000 : 1000);
    }
    if (!field) {
      const toggle = firstVisible(SELECTORS.letterToggle);
      if (toggle && isVisible(toggle)) {
        toggle.click();
        field = await waitForLetterField(3000);
      }
    }
    if (!field) {
      setStatus(
        'Не нашёл поле сопроводительного письма. Откройте форму отклика вручную и вставьте текст кнопкой «Копировать».',
        'error'
      );
      return;
    }

    setNativeValue(field, letter);
    field.focus();
    setStatus('Письмо вставлено в форму. Проверьте текст и отправьте отклик сами.', 'ok');
  }

  async function init() {
    if (!isVacancyPage()) {
      ui?.host.remove();
      ui = null;
      abortStream();
      return;
    }

    mount();
    const stored = await chrome.storage.local.get(COLLAPSED_KEY);
    collapsed = stored[COLLAPSED_KEY] !== false;
    applyCollapsed();
    ui.letter.value = '';
    setStatus('Нажмите «Сгенерировать» — письмо появится здесь.', 'info');
    await refreshHint();
  }

  function watchNavigation() {
    let lastUrl = location.href;
    new MutationObserver(() => {
      if (location.href === lastUrl) return;
      lastUrl = location.href;
      setTimeout(init, 500);
    }).observe(document, { subtree: true, childList: true });
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== 'hhcl:generate') return;
    mount();
    setCollapsed(false);
    generate();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.settings || changes[COLLAPSED_KEY])) refreshHint();
  });

  init();
  watchNavigation();
})();
