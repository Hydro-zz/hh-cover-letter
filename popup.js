const $ = (id) => document.getElementById(id);

const isVacancyUrl = (url) => /^https:\/\/([a-z0-9-]+\.)*hh\.ru\/vacancy\//.test(url || '');

function setCheck(dotId, textId, ok, okText, badText) {
  $(dotId).className = `dot ${ok ? 'ok' : 'bad'}`;
  $(textId).textContent = ok ? okText : badText;
}

function setHint(text) {
  $('hint').textContent = text;
}

async function render() {
  const status = await chrome.runtime.sendMessage({ type: 'status' }).catch(() => null);
  const config = status?.ok
    ? status
    : {
        provider: 'неизвестен',
        hasKey: false,
        needsKey: true,
        hasResume: false,
        hasResumeText: false
      };

  setCheck(
    'keyDot',
    'keyText',
    config.hasKey,
    config.needsKey ? `API-ключ задан (${config.provider})` : `Ключ не нужен (${config.provider})`,
    `API-ключ ${config.provider} не задан`
  );
  setCheck(
    'resumeDot',
    'resumeText',
    config.hasResume,
    config.hasResumeText ? 'Резюме загружено' : 'Резюме подтянется по ссылке',
    'Резюме не загружено'
  );

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const onVacancy = isVacancyUrl(tab?.url);

  $('generate').disabled = !(config.hasKey && config.hasResume && onVacancy);

  if (!status?.ok) {
    setHint('Фоновая часть расширения не ответила — перезагрузите расширение в chrome://extensions.');
  } else if (!config.hasKey) {
    setHint(`Откройте «Настройки» и укажите API-ключ ${config.provider}.`);
  } else if (!config.hasResume) {
    setHint('Откройте «Настройки»: укажите ссылку на резюме hh.ru или вставьте его текст.');
  } else if (!onVacancy) {
    setHint('Откройте страницу вакансии на hh.ru — кнопка станет активной.');
  } else {
    setHint(`Модель ${config.model || 'не выбрана'}. Можно генерировать прямо со страницы: там есть своя кнопка.`);
  }
}

$('generate').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'hhcl:generate' });
    window.close();
  } catch {
    setHint('Не удалось связаться со страницей. Обновите вкладку с вакансией (F5) и попробуйте снова.');
  }
});

$('openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());

$('openResume').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://hh.ru/applicant/resumes' });
});

render();
