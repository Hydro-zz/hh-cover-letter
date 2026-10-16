// Проверка страницы настроек: у каждого резюме свой текст, выбор не путается.
// Разметка берётся из настоящего options.html, Chrome подменяется заглушками. Запуск: npm test.
const fs = require('fs');
const path = require('path');
const url = require('url');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const R1 = 'https://hh.ru/resume/aaaa111111111111';
const R2 = 'https://hh.ru/resume/bbbb222222222222';

const results = [];
const check = (label, condition, detail) => {
  results.push({ label, pass: Boolean(condition) });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function boot() {
  const html = fs.readFileSync(path.join(ROOT, 'options.html'), 'utf8');
  const source = fs.readFileSync(path.join(ROOT, 'options.js'), 'utf8');

  const dom = new JSDOM(html, { url: 'https://extension.test/options.html', runScripts: 'outside-only' });
  const { window } = dom;

  // jsdom не реализует innerText, а он нужен коду
  Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
    get() {
      return this.textContent;
    },
    configurable: true
  });

  const stored = {
    settings: {
      provider: 'deepseek',
      model: 'deepseek-chat',
      apiKeys: { deepseek: 'sk-test' },
      resumeUrl: 'https://hh.ru/applicant/resumes',
      selectedResumeUrl: R1,
      resumes: [
        { url: R1, title: 'Python-разработчик', text: 'ПЕРВОЕ РЕЗЮМЕ', error: '' },
        { url: R2, title: 'Team Lead', text: 'ВТОРОЕ РЕЗЮМЕ', error: '' }
      ]
    }
  };

  // что вернёт «Перечитать» для каждого адреса
  const reread = { [R1]: 'ПЕРВОЕ ПЕРЕЧИТАНО', [R2]: 'ВТОРОЕ ПЕРЕЧИТАНО' };

  window.chrome = {
    runtime: {
      getManifest: () => ({ version: '1.2.1' }),
      sendMessage: async (msg) => {
        if (msg.type === 'ping') return { ok: true, version: '1.2.1', features: ['resolve-source'] };
        if (msg.type === 'status') {
          return { ok: true, provider: 'DeepSeek', endpoint: 'https://api.deepseek.com/v1/chat/completions', needsKey: true, hasKey: true, hasResume: true, hasResumeText: true };
        }
        if (msg.type === 'refresh-resume') {
          const item = stored.settings.resumes.find((entry) => entry.url === msg.url);
          if (item) item.text = reread[msg.url];
          return { ok: true, message: 'Резюме прочитано.' };
        }
        return { ok: true };
      },
      connect: () => ({
        onMessage: { addListener() {} },
        onDisconnect: { addListener() {} },
        postMessage() {},
        disconnect() {}
      }),
      reload() {},
      openOptionsPage() {}
    },
    storage: {
      local: {
        get: async (key) => (typeof key === 'string' ? { [key]: stored[key] } : { ...stored }),
        set: async (obj) => {
          Object.assign(stored, obj);
        }
      }
    },
    permissions: { contains: async () => true, request: async () => true }
  };

  window.__lib = await import(url.pathToFileURL(path.join(ROOT, 'lib.js')).href);

  // lib.js исполняется в Node-области, поэтому chrome нужен и в глобальной области
  globalThis.chrome = window.chrome;

  // модуль options.js исполняем в окне jsdom: импорт заменяем на подстановку из window.__lib
  const importRe = /import \{([\s\S]*?)\} from '\.\/lib\.js';/;
  const imported = source.match(importRe);
  if (!imported) throw new Error('в options.js не найден импорт из lib.js');

  const transformed = source.replace(importRe, `const {${imported[1]}} = globalThis.__lib;`);
  await window.eval(`(async () => {\n${transformed}\n})()`);
  await sleep(50);

  const $ = (id) => window.document.getElementById(id);

  return {
    window,
    stored,
    $,
    select: $('resumeChoice'),
    textarea: $('resume'),
    textOf: (resumeUrl) => stored.settings.resumes.find((entry) => entry.url === resumeUrl)?.text,
    async switchTo(resumeUrl) {
      $('resumeChoice').value = resumeUrl;
      $('resumeChoice').dispatchEvent(new window.Event('change'));
      await sleep(80);
    }
  };
}

(async () => {
  const page = await boot();

  check('запуск: список резюме показан', page.$('resumePicker').hidden === false);
  check('запуск: в списке два резюме', page.select.options.length === 2, String(page.select.options.length));
  check('запуск: выбран адрес из настроек', page.select.value === R1, page.select.value);
  check('запуск: показан текст первого резюме', page.textarea.value === 'ПЕРВОЕ РЕЗЮМЕ', page.textarea.value);

  // --- сценарий из сообщения об ошибке: переключение резюме --------------------
  await page.switchTo(R2);
  check('переключение: показан текст второго резюме', page.textarea.value === 'ВТОРОЕ РЕЗЮМЕ', page.textarea.value);
  check('переключение: текст первого резюме не затёрт', page.textOf(R1) === 'ПЕРВОЕ РЕЗЮМЕ', page.textOf(R1));
  check('переключение: текст второго резюме сохранён', page.textOf(R2) === 'ВТОРОЕ РЕЗЮМЕ', page.textOf(R2));

  // --- правка применятся к тому резюме, что показано ---------------------------
  page.textarea.value = 'ПРАВКА ВТОРОГО';
  page.textarea.dispatchEvent(new page.window.Event('input'));

  await page.switchTo(R1);
  check('возврат: показан текст первого резюме', page.textarea.value === 'ПЕРВОЕ РЕЗЮМЕ', page.textarea.value);
  check('возврат: правка осталась во втором резюме', page.textOf(R2) === 'ПРАВКА ВТОРОГО', page.textOf(R2));

  // --- «Перечитать» заменяет текст, а не дописывает ----------------------------
  page.$('reloadResume').click();
  await sleep(200);

  check('перечитать: текст заменён, а не дописан', page.textOf(R1) === 'ПЕРВОЕ ПЕРЕЧИТАНО', page.textOf(R1));
  check('перечитать: в поле новый текст', page.textarea.value === 'ПЕРВОЕ ПЕРЕЧИТАНО', page.textarea.value);

  // --- «Перечитать» не сбрасывает список на резюме по умолчанию ----------------
  await page.switchTo(R2);
  page.$('reloadResume').click();
  await sleep(200);

  check('перечитать второе: список остался на втором резюме', page.select.value === R2, page.select.value);
  check('перечитать второе: показан его текст', page.textarea.value === 'ВТОРОЕ ПЕРЕЧИТАНО', page.textarea.value);
  check('перечитать второе: первое резюме не пострадало', page.textOf(R1) === 'ПЕРВОЕ ПЕРЕЧИТАНО', page.textOf(R1));

  const failed = results.filter((item) => !item.pass);
  console.log(`\n${results.length - failed.length}/${results.length} проверок пройдено`);
  process.exit(failed.length ? 1 : 0);
})();
