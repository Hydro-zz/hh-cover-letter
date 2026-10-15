// Проверка разбора страницы hh.ru на настоящем DOM.
// Разметка hh.ru — самая хрупкая часть расширения, поэтому карточки резюме проверяются на реальных структурах.
// Запуск: npm test (нужен npm install для установки jsdom).
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const backgroundPath = path.join(__dirname, '..', 'background.js');
const source = fs.readFileSync(backgroundPath, 'utf8');

// Функция разбора объявлена на верхнем уровне и выполняется в контексте вкладки,
// поэтому для проверки достаточно вырезать её исходник и выполнить в jsdom.
const start = source.indexOf('function extractHhPage()');
if (start < 0) throw new Error('extractHhPage не найдена в background.js');

const end = source.indexOf('\n}', start);
if (end < 0) throw new Error('не найден конец extractHhPage');

const functionSource = source.slice(start, end + 2);

const results = [];
const check = (label, condition, detail) => {
  results.push({ label, pass: Boolean(condition) });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

function buildPage(html, url) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`, {
    url,
    runScripts: 'outside-only'
  });

  // jsdom не реализует innerText, а разбор на него опирается
  Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', {
    get() {
      return this.textContent;
    },
    configurable: true
  });

  return dom.window.eval(`${functionSource}\n; extractHhPage`);
}

const PROFILE_URL = 'https://hh.ru/applicant/resumes';

// --- A. страница профиля: карточки резюме и служебная ссылка --------------------
const profile = buildPage(
  `
<main>
  <h1>Иван Иванов</h1>
  <div class="resume-list">
    <div class="card">
      <a data-qa="resume-card-link" href="https://hh.ru/resume/aaaa111111111111">
        <span data-qa="cell-text-content">Python-разработчик</span>
      </a>
    </div>
    <div class="card">
      <a data-qa="resume-card-link" href="https://hh.ru/resume/bbbb222222222222">
        <span data-qa="cell-text-content">Team Lead</span>
      </a>
    </div>
  </div>
  <a href="https://hh.ru/resume/new">Создать резюме</a>
</main>`,
  PROFILE_URL
)();

check('профиль: найдено ровно 2 резюме', profile.resumes.length === 2, `найдено ${profile.resumes.length}`);
check(
  'профиль: ссылка «создать резюме» отсеяна',
  !profile.resumes.some((item) => item.url.includes('/resume/new')),
  profile.resumes.map((item) => item.url).join(' ')
);
check('профиль: название первого резюме', profile.resumes[0]?.title === 'Python-разработчик', profile.resumes[0]?.title);
check('профиль: название второго резюме', profile.resumes[1]?.title === 'Team Lead', profile.resumes[1]?.title);
check('профиль: имя распознано', profile.name === 'Иван Иванов', profile.name);
check('профиль: адреса без хвостов', profile.resumes.every((item) => /^https:\/\/hh\.ru\/resume\/\w+$/.test(item.url)));

// --- B. запасной путь: страница без карточек, только общие ссылки ---------------
const legacy = buildPage(
  `
<main>
  <h1>Пётр Петров</h1>
  <a href="https://hh.ru/resume/cccc333333333333"><span data-qa="cell-text-content">Аналитик</span></a>
  <a href="https://hh.ru/resume/new">Создать резюме</a>
  <a href="https://hh.ru/resume/">Мои резюме</a>
</main>`,
  PROFILE_URL
)();

check('запасной путь: ровно 1 резюме', legacy.resumes.length === 1, `найдено ${legacy.resumes.length}`);
check(
  'запасной путь: посторонние ссылки отсеяны',
  legacy.resumes[0]?.url === 'https://hh.ru/resume/cccc333333333333',
  legacy.resumes.map((item) => item.url).join(' ')
);
check('запасной путь: название из текстового узла', legacy.resumes[0]?.title === 'Аналитик', legacy.resumes[0]?.title);

// --- C. название лежит рядом со ссылкой, внутри той же карточки -----------------
const beside = buildPage(
  `
<main>
  <h1>Анна Смирнова</h1>
  <div class="card">
    <span data-qa="cell-text-content">Дата-инженер</span>
    <a data-qa="resume-card-link" href="https://hh.ru/resume/dddd444444444444">Открыть</a>
  </div>
</main>`,
  PROFILE_URL
)();

check('название рядом со ссылкой найдено', beside.resumes[0]?.title === 'Дата-инженер', beside.resumes[0]?.title);

// --- D. общий контейнер: чужой заголовок не подставляется ----------------------
const shared = buildPage(
  `
<main>
  <h1>Олег Кузнецов</h1>
  <div class="list">
    <span data-qa="cell-text-content">Общий текст списка</span>
    <a data-qa="resume-card-link" href="https://hh.ru/resume/eeee555555555555">Первый</a>
    <a data-qa="resume-card-link" href="https://hh.ru/resume/ffff666666666666">Второй</a>
  </div>
</main>`,
  PROFILE_URL
)();

check('два резюме из общего контейнера', shared.resumes.length === 2, `найдено ${shared.resumes.length}`);
check(
  'заголовок из общего контейнера не подставлен',
  shared.resumes.every((item) => item.title === 'Первый' || item.title === 'Второй'),
  shared.resumes.map((item) => item.title).join(' / ')
);

// --- E. страница конкретного резюме --------------------------------------------
const resumePage = buildPage(
  `
<main>
  <div data-qa="resume">
    <h1>Python-разработчик</h1>
    <div>Опыт работы: 8 лет. Django, PostgreSQL.</div>
  </div>
</main>`,
  'https://hh.ru/resume/aaaa111111111111'
)();

check('страница резюме распознана', resumePage.isResume === true);
check('текст резюме собран', resumePage.text.includes('Django'), resumePage.text.split('\n')[0]);
check('на странице резюме нет ложных записей', resumePage.resumes.length === 0, `найдено ${resumePage.resumes.length}`);

const failed = results.filter((item) => !item.pass);
console.log(`\n${results.length - failed.length}/${results.length} проверок пройдено`);
process.exit(failed.length ? 1 : 0);
