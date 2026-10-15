// Проверка фоновой логики: список резюме, разбор всех резюме, выбор резюме для вакансии и генерация.
// Chrome подменяется заглушками, поэтому проверки идут без браузера. Запуск: npm test.
const path = require('path');
const url = require('url');

const RESUME_URL_1 = 'https://hh.ru/resume/aaaa111111111111';
const RESUME_URL_2 = 'https://hh.ru/resume/bbbb222222222222';
const VACANCY_URL = 'https://hh.ru/vacancy/12345';

const storage = { settings: {} };
const listeners = { onConnect: [], onMessage: [], onCommand: [] };
const openTabs = [];
const tabUrls = new Map();
let profilePage = null;
let failResumeRead = false;
const fetchCalls = [];

globalThis.chrome = {
  runtime: {
    onConnect: { addListener: (fn) => listeners.onConnect.push(fn) },
    onMessage: { addListener: (fn) => listeners.onMessage.push(fn) },
    onCommand: { addListener: (fn) => listeners.onCommand.push(fn) },
    getManifest: () => ({ version: '1.2.0' })
  },
  commands: { onCommand: { addListener: (fn) => listeners.onCommand.push(fn) } },
  storage: {
    local: {
      get: async (key) => (typeof key === 'string' ? { [key]: storage[key] } : { ...storage }),
      set: async (obj) => Object.assign(storage, obj)
    }
  },
  tabs: {
    async create({ url: tabUrl }) {
      const tab = { id: 900 + openTabs.length, url: tabUrl };
      openTabs.push(tab);
      tabUrls.set(tab.id, tabUrl);
      return tab;
    },
    async query() {
      return [];
    },
    async remove(id) {
      const index = openTabs.findIndex((tab) => tab.id === id);
      if (index >= 0) openTabs.splice(index, 1);
    },
    async sendMessage() {}
  },
  scripting: {
    async executeScript({ target }) {
      const tabUrl = tabUrls.get(target.tabId) || '';
      const hash = (tabUrl.match(/\/resume\/([^/?#]+)/) || [])[1];

      if (!hash) return [{ result: profilePage }];
      if (failResumeRead) {
        return [{ result: { isResume: true, name: '', resumes: [], text: 'слишком мало текста' } }];
      }
      return [
        {
          result: {
            isResume: true,
            name: 'Иван Иванов',
            resumes: [],
            text: `РЕЗЮМЕ ${hash} `.repeat(12)
          }
        }
      ];
    }
  }
};

const sseChunks = [
  `data: ${JSON.stringify({ choices: [{ delta: { content: 'Здравствуйте! ' }, finish_reason: null }] })}\n\n`,
  `data: ${JSON.stringify({ choices: [{ delta: { content: 'Письмо.' }, finish_reason: 'stop' }] })}\n\n`
];

const encoder = new TextEncoder();

globalThis.fetch = async (_url, init) => {
  fetchCalls.push(JSON.parse(init.body));
  let index = 0;
  return {
    ok: true,
    status: 200,
    json: async () => ({}),
    body: {
      getReader: () => ({
        read: async () => (index < sseChunks.length ? { done: false, value: encoder.encode(sseChunks[index++]) } : { done: true })
      })
    }
  };
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function message(type, payload = {}) {
  const result = await new Promise((resolve) => {
    let handled = false;
    for (const listener of listeners.onMessage) {
      if (listener({ type, ...payload }, {}, resolve) === true) handled = true;
    }
    setTimeout(() => {
      if (!handled) resolve(undefined);
    }, 30000);
  });
  return result;
}

// Запускает массовый разбор через порт 'resumes' и собирает прогресс.
async function parseAllViaPort({ force = false } = {}) {
  const progress = [];
  let portHandler = null;
  let finish = null;
  let settle = null;

  const port = {
    name: 'resumes',
    onMessage: { addListener: (fn) => (portHandler = fn) },
    onDisconnect: { addListener() {} },
    postMessage: (msg) => {
      if (msg.type === 'progress') progress.push(msg);
      else if (finish) finish(msg);
    }
  };

  listeners.onConnect.forEach((fn) => fn(port));

  const result = new Promise((resolve) => {
    settle = resolve;
    finish = resolve;
  });

  await portHandler({ type: 'parse', force });
  const outcome = await Promise.race([result, sleep(20000).then(() => ({ ok: false, message: 'таймаут' }))]);
  return { outcome, progress, settle };
}

async function generate(patch) {
  Object.assign(storage.settings, patch);
  const received = [];
  let handler = null;

  const port = {
    name: 'llm',
    onMessage: { addListener: (fn) => (handler = fn) },
    onDisconnect: { addListener() {} },
    postMessage: (msg) => received.push(msg)
  };

  listeners.onConnect.forEach((fn) => fn(port));
  await handler({ type: 'generate', vacancy: { url: VACANCY_URL, title: 'Dev', description: 'Python, Django. '.repeat(10) }, ...patch.message });

  for (let i = 0; i < 100 && !received.some((m) => m.type === 'done' || m.type === 'error'); i += 1) {
    await sleep(20);
  }
  return received;
}

const results = [];
const check = (label, condition, detail) => {
  results.push({ label, pass: Boolean(condition) });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

(async () => {
  const lib = await import(url.pathToFileURL(path.join(__dirname, '..', 'lib.js')).href);
  await import(url.pathToFileURL(path.join(__dirname, '..', 'background.js')).href);

  const titles = { [RESUME_URL_1]: 'Python-разработчик', [RESUME_URL_2]: 'Team Lead' };
  const profileInfo = () => ({
    isResume: false,
    name: 'Иван Иванов',
    resumes: [
      { url: RESUME_URL_1, title: titles[RESUME_URL_1] },
      { url: RESUME_URL_2, title: titles[RESUME_URL_2] }
    ],
    text: 'Мои резюме'
  });

  // --- 1. миграция настроек версии 1.1.x ---------------------------------------
  storage.settings = {
    apiKeys: { deepseek: 'sk-test' },
    resume: 'СТАРЫЙ ТЕКСТ',
    selectedResumeUrl: RESUME_URL_1,
    resumeOptions: [
      { url: RESUME_URL_1, title: 'Python-разработчик' },
      { url: RESUME_URL_2, title: 'Team Lead' }
    ]
  };

  const migrated = await lib.loadSettings();
  check('миграция: два резюме в списке', migrated.resumes.length === 2, String(migrated.resumes.length));
  check('миграция: текст привязан к выбранному резюме', migrated.resumes[0].text === 'СТАРЫЙ ТЕКСТ', migrated.resumes[0].text);
  check('миграция: у второго резюме текста нет', migrated.resumes[1].text === '', migrated.resumes[1].text);
  check('миграция: старые поля удалены', migrated.resume === undefined && migrated.resumeOptions === undefined);

  // --- 2. загрузка страницы профиля -------------------------------------------
  storage.settings = { apiKeys: { deepseek: 'sk-test' }, resumeUrl: 'https://hh.ru/applicant/resumes' };
  profilePage = profileInfo();

  const resolved = await message('resolve-source');
  check('профиль: найдено два резюме', resolved?.ok === true && resolved.resumes.length === 2, String(resolved?.resumes?.length));
  check('профиль: названия сохранены', resolved?.resumes?.map((item) => item.title).join(' / ') === 'Python-разработчик / Team Lead');
  check('профиль: имя сохранено', storage.settings.fullName === 'Иван Иванов', storage.settings.fullName);
  check('профиль: тексты пока пусты', resolved?.resumes?.every((item) => item.hasText === false));
  check('профиль: вкладки закрыты', openTabs.length === 0, `осталось ${openTabs.length}`);

  // --- 3. массовый разбор всех резюме -----------------------------------------
  const first = await parseAllViaPort();

  check('разбор: завершился успешно', first.outcome?.ok === true, first.outcome?.message);
  check('разбор: прочитано 2 из 2', first.outcome?.parsed === 2 && first.outcome?.total === 2, `${first.outcome?.parsed}/${first.outcome?.total}`);
  check('разбор: прогресс пришёл', first.progress.length >= 2, `сообщений ${first.progress.length}`);
  check('разбор: вкладки закрыты после разбора', openTabs.length === 0, `осталось ${openTabs.length}`);

  const afterParse = await lib.loadSettings();
  check(
    'разбор: у каждого резюме свой текст',
    afterParse.resumes[0].text.includes('aaaa111111111111') && afterParse.resumes[1].text.includes('bbbb222222222222'),
    `${afterParse.resumes[0].text.slice(0, 20)} | ${afterParse.resumes[1].text.slice(0, 20)}`
  );

  // --- 4. повторный разбор без force не трогает прочитанное --------------------
  const second = await parseAllViaPort();
  check('повторный разбор: ничего не перечитывал', second.outcome?.parsed === 2 && second.progress.every((item) => item.skipped), 'все пропущены');

  const forced = await parseAllViaPort({ force: true });
  check('принудительный разбор: перечитал оба', forced.outcome?.parsed === 2, String(forced.outcome?.parsed));

  // --- 5. выбор резюме для конкретной вакансии --------------------------------
  storage.settings.selectedResumeUrl = RESUME_URL_1; // резюме по умолчанию из настроек
  await message('set-vacancy-resume', { vacancyUrl: VACANCY_URL, resumeUrl: RESUME_URL_2 });

  const withChoice = await lib.loadSettings();
  check('выбор для вакансии сохранён', withChoice.resumeByVacancy[VACANCY_URL] === RESUME_URL_2);
  check('для этой вакансии берётся выбранное резюме', lib.resumeUrlForVacancy(withChoice, VACANCY_URL) === RESUME_URL_2);
  check(
    'для другой вакансии остаётся резюме по умолчанию',
    lib.resumeUrlForVacancy(withChoice, 'https://hh.ru/vacancy/999') === RESUME_URL_1
  );

  await message('set-vacancy-resume', { vacancyUrl: VACANCY_URL, resumeUrl: RESUME_URL_1 });
  const backToFirst = await lib.loadSettings();
  check('выбор для вакансии перезаписывается', lib.resumeUrlForVacancy(backToFirst, VACANCY_URL) === RESUME_URL_1);

  // --- 6. генерация использует выбранное резюме --------------------------------
  const generation = await generate({ provider: 'deepseek', model: 'deepseek-chat' });
  const done = generation.find((item) => item.type === 'done');
  const prompt = fetchCalls[fetchCalls.length - 1]?.messages?.[1]?.content || '';

  check('генерация: письмо собрано', done?.length === 'Здравствуйте! Письмо.'.length, String(done?.length));
  check('генерация: в промпт попало резюме, выбранное для вакансии', prompt.includes('aaaa111111111111'), 'ожидалось первое резюме');
  check('генерация: чужое резюме в промпт не попало', !prompt.includes('bbbb222222222222'));

  // выбор в панели важнее сохранённого
  const explicit = await generate({ provider: 'deepseek', model: 'deepseek-chat', message: { resumeUrl: RESUME_URL_2 } });
  const explicitPrompt = fetchCalls[fetchCalls.length - 1]?.messages?.[1]?.content || '';
  check('генерация: явный выбор из панели приоритетнее', explicitPrompt.includes('bbbb222222222222'), 'ожидалось второе резюме');
  check('генерация: завершилась без ошибок', explicit.some((item) => item.type === 'done'));

  // --- 7. статус ---------------------------------------------------------------
  const status = await message('status');
  check('статус: список резюме с признаком текста', status.resumes.length === 2 && status.resumes.every((item) => item.hasText));
  check('статус: выбор по умолчанию указан', status.selectedResumeUrl === RESUME_URL_1, status.selectedResumeUrl);
  check('статус: карта выбора по вакансиям передана', status.resumeByVacancy[VACANCY_URL] === RESUME_URL_1);
  check('статус: имя передано', status.hasName === true && status.fullName === 'Иван Иванов');

  // --- 8. пустой текст резюме: подтягивается на месте --------------------------
  storage.settings.resumes = storage.settings.resumes.map((item) => ({ ...item, text: '' }));
  storage.settings.resumeByVacancy = {};

  const autoRead = await generate({ provider: 'deepseek', model: 'deepseek-chat' });
  const autoPrompt = fetchCalls[fetchCalls.length - 1]?.messages?.[1]?.content || '';

  check('генерация без текста: резюме читается на месте', autoRead.some((item) => item.type === 'done'));
  check('генерация без текста: в промпт попал прочитанный текст', /РЕЗЮМЕ \w+/.test(autoPrompt));

  // --- 9. резюме не читается: понятная ошибка ---------------------------------
  failResumeRead = true;
  storage.settings.resumes = storage.settings.resumes.map((item) => ({ ...item, text: '' }));

  const broken = await generate({ provider: 'deepseek', model: 'deepseek-chat' });
  const brokenError = broken.find((item) => item.type === 'error');

  check(
    'генерация: нечитаемое резюме объясняется',
    Boolean(brokenError?.message) && /резюм/i.test(brokenError.message),
    brokenError?.message
  );

  failResumeRead = false;

  const failed = results.filter((item) => !item.pass);
  console.log(`\n${results.length - failed.length}/${results.length} проверок пройдено`);
  process.exit(failed.length ? 1 : 0);
})();
