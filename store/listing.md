# Тексты для витрины Chrome Web Store

Скопировать в кабинет разработчика. Ограничения полей: название до 45 знаков, краткое описание до 132 знаков.

## Русский

**Название:** HH Cover Letter

**Краткое описание:**
Сопроводительное письмо под каждую вакансию hh.ru: расширение читает вакансию и ваше резюме и пишет текст через LLM.

**Категория:** Productivity («Продуктивность»)
**Язык:** русский (дополнительно английский)

**Подробное описание:**

Отклик с сопроводительным письмом читают охотнее, а некоторые компании его прямо требуют. Писать заново под каждую
вакансию долго и лень.

HH Cover Letter добавляет на страницу вакансии hh.ru кнопку «Письмо под вакансию». Одно нажатие — и у вас готов
черновик: он опирается на ваше резюме и на то, что реально написано в вакансии.

**Как это работает**

1. Откройте вакансию на hh.ru.
2. Нажмите «✍ Письмо под вакансию» в правом нижнем углу (или `Alt+Shift+C`).
3. Текст печатается на глазах — его можно сразу править.
4. Кнопка «Вставить в отклик» подставляет письмо в форму отклика.

Отправку отклика расширение никогда не делает само: последнее слово всегда за вами.

**Почему письма получаются не шаблонными**

Расширение передаёт модели текст вакансии и ваше резюме и требует жёстких правил: опираться только на факты из резюме,
не выдумывать опыт и цифры, не оставлять плейсхолдеров вида «[Ваше имя]», не сыпать штампами вроде «стрессоустойчив».
Тон, объём и язык письма вы задаёте сами, а в дополнительных пожеланиях можно написать, например, «подчеркни опыт
с Kafka».

**Любая модель на выбор**

Расширение работает с любым OpenAI-совместимым API: DeepSeek, OpenAI, OpenRouter, Groq, Mistral, Google Gemini,
а также с локальными Ollama и LM Studio — совсем без облака. Свой сервер тоже можно указать, если он говорит на том же
протоколе. Модель вписывается вручную, так что новые версии доступны сразу.

**Ключ — ваш**

Расширение не имеет собственного сервера и не берёт с вас денег. Вы используете свой API-ключ провайдера, поэтому
платите только за свои запросы (одно письмо — доли цента), и никто не платит за вас. Если ключа нет, поставьте
Ollama локально: будет бесплатно и полностью приватно.

**Приватность**

- Ключ и резюме хранятся только у вас в браузере.
- Вакансия и резюме уходят исключительно на тот сервер, который вы выбрали сами.
- Никакой аналитики, телеметрии и рекламы. У разработчика нет ни данных, ни доступа к ним.
- Подробнее: политика конфиденциальности проекта.

**Что стоит знать**

- Нужен ключ API (кроме локальных моделей).
- Разметка hh.ru иногда меняется: если кнопка перестала находить вакансию, напишите в Issues — поправим.
- Письмо — черновик. Модель опирается только на ваше резюме, но текст стоит вычитать.
- Расширение работает на hh.ru; другие job-борды не поддерживаются.

## English

**Name:** HH Cover Letter

**Short description:**
Cover letter for every hh.ru vacancy: the extension reads the job post and your resume and writes the letter with an LLM.

**Category:** Productivity
**Language:** Russian (English localization included)

**Detailed description:**

Applications with a cover letter get more attention, and some employers require one. Writing a new letter for every
vacancy is slow and tedious.

HH Cover Letter adds a "Letter for this vacancy" button to any hh.ru vacancy page. One click gives you a draft based on
your resume and on what the job post actually says.

**How it works**

1. Open a vacancy on hh.ru.
2. Click "✍ Letter for this vacancy" in the bottom-right corner (or press `Alt+Shift+C`).
3. The text is typed out in front of you and can be edited right away.
4. The "Insert into response" button puts the letter into the application form.

The extension never submits an application by itself — the final click is always yours.

**Why the letters are not generic**

The extension sends the job post and your resume to the model and enforces strict rules: use facts from the resume only,
never invent experience or numbers, never leave placeholders like "[Your name]", never pad with clichés. You control tone,
length and language, and you can add notes such as "emphasise my Kafka experience".

**Bring your own model**

Works with any OpenAI-compatible API: DeepSeek, OpenAI, OpenRouter, Groq, Mistral, Google Gemini, plus local Ollama and
LM Studio for a fully offline setup. Your own server works too if it speaks the same protocol. The model name is typed
in, so new models work immediately.

**Bring your own key**

The extension has no backend and charges nothing. You use your own provider API key, so you pay only for your own requests
(a letter costs a fraction of a cent) and nobody pays for anyone else. Without a key, run Ollama locally — free and
completely private.

**Privacy**

- Your key and resume stay in your browser.
- The vacancy and resume go only to the server you selected.
- No analytics, no telemetry, no ads. The developer holds no data and has no access to it.
- See the project's privacy policy for details.

**Good to know**

- An API key is required (except for local models).
- hh.ru markup changes from time to time: if the button stops finding the vacancy, open an issue.
- The letter is a draft. The model relies on your resume only, but do proofread the text.
- Works on hh.ru; other job boards are not supported.

## Скриншоты

Нужно 1–5 штук, размер 1280×800 или 640×400. Точки съёмки — в [checklist.md](./checklist.md):

1. Панель на странице вакансии: заголовок вакансии и кнопка «Сгенерировать».
2. Генерация в процессе: текст письма печатается, статус показывает результат.
3. Письмо, вставленное в форму отклика (видно, что поле заполнено, кнопка «Отправить» не нажата).
4. Настройки, блок «Провайдер и модель»: список провайдеров и подсказки моделей.
5. Настройки, блок «Резюме»: ссылка и загруженный текст.

## Что нового (для первого релиза)

Первый публичный выпуск: генерация сопроводительных писем под вакансию hh.ru, выбор из 9 провайдеров модели,
локальные модели без ключа, загрузка резюме по ссылке.
