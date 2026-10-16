// Проверка панели на странице вакансии: список резюме и передача выбора в генерацию.
// content.js исполняется в jsdom на подготовленной странице hh.ru. Запуск: npm test.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const VACANCY_URL = 'https://hh.ru/vacancy/12345';
const R1 = 'https://hh.ru/resume/aaaa111111111111';
const R2 = 'https://hh.ru/resume/bbbb222222222222';

const results = [];
const check = (label, condition, detail) => {
  results.push({ label, pass: Boolean(condition) });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const VACANCY_HTML = `
  <h1 data-qa="vacancy-title">Python-разработчик</h1>
  <div data-qa="vacancy-company-name">ООО Ромашка</div>
  <div data-qa="vacancy-description">
    Требования: Python, Django, PostgreSQL, опыт от трёх лет. ${'Ещё требования к кандидату. '.repeat(8)}
  </div>
  <a data-qa="vacancy-response-link-top" href="#">Откликнуться</a>
`;

async function boot(statusPatch = {}) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${VACANCY_HTML}</body></html>`, {
    url: VACANCY_URL,
    runScripts: 'outside-only'
  });
  const { window } = dom;

  // jsdom не реализует innerText, а панель на него опирается
  Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
    get() {
      return this.textContent;
    },
    configurable: true
  });

  const status = {
    ok: true,
    provider: 'DeepSeek',
    model: 'deepseek-chat',
    hasKey: true,
    needsKey: true,
    hasName: true,
    fullName: 'Иван Иванов',
    hasResume: true,
    hasResumeText: true,
    resumes: [
      { url: R1, title: 'Python-разработчик', hasText: true, error: '' },
      { url: R2, title: 'Team Lead', hasText: true, error: '' }
    ],
    resumeByVacancy: {},
    selectedResumeUrl: R1,
    ...statusPatch
  };

  const sent = [];
  const portMessages = [];
  const storage = { settings: {} };

  window.chrome = {
    runtime: {
      sendMessage: async (msg) => {
        sent.push(msg);
        if (msg.type === 'status') return status;
        return { ok: true };
      },
      connect: () => ({
        onMessage: { addListener() {} },
        onDisconnect: { addListener() {} },
        postMessage: (msg) => portMessages.push(msg),
        disconnect() {}
      }),
      onMessage: { addListener() {} },
      openOptionsPage() {}
    },
    storage: {
      local: {
        get: async (key) => (typeof key === 'string' ? { [key]: storage[key] } : { ...storage }),
        set: async (obj) => Object.assign(storage, obj)
      },
      onChanged: { addListener() {} }
    }
  };

  window.eval(fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8'));
  await sleep(150);

  const shadow = window.document.getElementById('hh-cover-letter-root')?.shadowRoot;

  return {
    window,
    shadow,
    sent,
    portMessages,
    row: shadow?.querySelector('.resumeRow'),
    select: shadow?.querySelector('.resumeRow select'),
    async choose(resumeUrl) {
      const select = shadow.querySelector('.resumeRow select');
      select.value = resumeUrl;
      select.dispatchEvent(new window.Event('change'));
      await sleep(100);
    }
  };
}

(async () => {
  // --- 1. список резюме в панели -------------------------------------------------
  const panel = await boot();

  check('панель создана', Boolean(panel.row && panel.select));
  check('список резюме виден', panel.row?.hidden === false, `hidden=${panel.row?.hidden}`);
  check('в списке два резюме', panel.select?.options.length === 2, String(panel.select?.options.length));
  check(
    'названия резюме в списке',
    [...(panel.select?.options || [])].map((option) => option.textContent).join(' / ') === 'Python-разработчик / Team Lead',
    [...(panel.select?.options || [])].map((option) => option.textContent).join(' / ')
  );
  check('по умолчанию выбрано резюме из настроек', panel.select?.value === R1, panel.select?.value);

  // --- 2. выбор другого резюме для вакансии -------------------------------------
  await panel.choose(R2);

  const choice = panel.sent.find((msg) => msg.type === 'set-vacancy-resume');
  check('выбор отправлен в фоновую часть', Boolean(choice), JSON.stringify(panel.sent.map((m) => m.type)));
  check('выбор привязан к вакансии', choice?.vacancyUrl === VACANCY_URL, choice?.vacancyUrl);
  check('выбор содержит второе резюме', choice?.resumeUrl === R2, choice?.resumeUrl);

  // --- 3. генерация получает выбранное резюме ------------------------------------
  panel.shadow.querySelector('.generate').click();
  await sleep(150);

  const generate = panel.portMessages.find((msg) => msg.type === 'generate');
  check('генерация запрошена', Boolean(generate));
  check('генерация идёт с выбранным резюме', generate?.resumeUrl === R2, generate?.resumeUrl);
  check('в генерацию передан текст вакансии', Boolean(generate?.vacancy?.description));

  // --- 4. выбор для вакансии из настроек подхватывается --------------------------
  const preset = await boot({ resumeByVacancy: { [VACANCY_URL]: R2 } });
  check('сохранённый выбор для вакансии подставлен', preset.select?.value === R2, preset.select?.value);

  // --- 5. без резюме список не показывается --------------------------------------
  const empty = await boot({ resumes: [], hasResume: false, hasResumeText: false, selectedResumeUrl: '' });
  check('без резюме список скрыт', empty.row?.hidden === true, `hidden=${empty.row?.hidden}`);

  const failed = results.filter((item) => !item.pass);
  console.log(`\n${results.length - failed.length}/${results.length} проверок пройдено`);
  process.exit(failed.length ? 1 : 0);
})();
