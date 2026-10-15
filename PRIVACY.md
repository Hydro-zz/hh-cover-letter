# Политика конфиденциальности — HH Cover Letter

Дата вступления в силу: 15 октября 2026 года.
Применимо к расширению HH Cover Letter для браузеров на базе Chromium.

## Кратко

- Расширение **не отправляет данные разработчику**. У него нет аналитики, телеметрии, рекламы и внешних счётчиков.
- API-ключи и текст резюме хранятся **только на вашем компьютере** — в локальном хранилище браузера.
- Текст вакансии и текст резюме передаются **только на тот сервер языковой модели, который вы выбрали сами**
  в настройках расширения. Других получателей нет.
- Если вы выбрали локальную модель (Ollama, LM Studio), данные вообще не покидают ваш компьютер.
- Отклик на вакансию расширение никогда не отправляет само — это делаете вы вручную.

## Какие данные обрабатывает расширение

| Данные | Зачем | Откуда берутся |
| --- | --- | --- |
| Текст вакансии (должность, компания, описание, требования) | Чтобы письмо соответствовало конкретной вакансии | Со страницы вакансии hh.ru, которую вы открыли |
| Текст резюме (каждого, если их несколько) | Чтобы письмо опиралось только на реальный опыт | Со страниц ваших резюме на hh.ru или из поля в настройках |
| Сопроводительное письмо | Результат, который вы проверяете и правите | Генерируется языковой моделью по вашему запросу |
| API-ключ провайдера модели | Авторизация запросов к выбранному вами сервису | Вы вводите его в настройках |
| Имя и фамилия для подписи | Чтобы подписать письмо вашим именем | Со страницы вашего профиля hh.ru или из поля в настройках |
| Настройки (провайдер, модель, тон, объём, язык, пожелания) | Чтобы не вводить их каждый раз | Вы задаёте в настройках |

## Где хранятся данные

Все перечисленные данные, включая API-ключи, хранятся в локальном хранилище расширения
(`chrome.storage.local`) внутри профиля вашего браузера. Они не синхронизируются между устройствами и недоступны
разработчику. Пароль от аккаунта hh.ru расширение не запрашивает и не читает.

## Кому передаются данные

Единственная передача данных — запрос к серверу языковой модели, выбранному вами в настройках. Вместе с запросом
на этот сервер уходят текст вакансии, текст резюме, имя для подписи и ваши пожелания к стилю; в ответ приходит текст
письма.

- **Облачные провайдеры** (DeepSeek, OpenAI, OpenRouter, Groq, Mistral, Google Gemini и другие) — обработка данных
  регулируется их собственными политиками и условиями. Перед выбором провайдера ознакомьтесь с ними.
- **Локальные серверы** (Ollama, LM Studio, свой сервер в вашей сети) — данные остаются у вас. Расширение
  обращается к адресу, который вы указали сами.

Ключ доступа отправляется только тому провайдеру, которому он принадлежит, и только в заголовке авторизации запроса.
Расширение не проксирует запросы через серверы разработчика и не имеет собственного сервера.

## Чего расширение не делает

- Не собирает статистику использования, не отправляет отчёты об ошибках и не устанавливает идентификаторы отслеживания.
- Не читает содержимое других вкладок и страниц: доступ ограничен доменом hh.ru и происходит только при действии
  пользователя.
- Не продаёт и не передаёт данные третьим лицам помимо выбранного вами провайдера модели.
- Не отправляет отклики на вакансии от вашего имени.
- Не выводит рекламу.

## Удаление данных

Удалите расширение в браузере (`chrome://extensions` → «Удалить») — вместе с ним удаляются все сохранённые данные,
включая API-ключ и текст резюме. Ничего не остаётся на стороне разработчика, потому что там ничего не хранится.

Уже отправленные провайдеру модели данные удаляются по правилам этого провайдера: обратитесь к его политике
конфиденциальности и настройкам аккаунта.

## Разрешения и зачем они нужны

| Разрешение | Назначение |
| --- | --- |
| `storage` | Хранение настроек, ключа и текста резюме локально |
| `activeTab` | Доступ к текущей вкладке только по вашему действию (кнопка, popup, горячая клавиша) |
| `scripting` | Чтение текста вашего резюме со страницы hh.ru по нажатию кнопки «Загрузить резюме» |
| Доступ к `hh.ru` | Чтение текста вакансии и вставка письма в форму отклика |
| Доступ к доменам провайдеров моделей | Отправка запроса к выбранному вами сервису |
| Необязательный доступ к произвольному домену | Для вашего собственного OpenAI-совместимого сервера; запрашивается по кнопке и может быть отозван в любой момент |

## Дети

Расширение не предназначено для детей младше 13 лет и не собирает данные о них.

## Изменения политики

Актуальная версия политики всегда находится в репозитории проекта. Существенные изменения отражаются в
[CHANGELOG.md](./CHANGELOG.md) и сопровождаются новой версией расширения.

## Контакт

Вопросы и обращения: раздел Issues репозитория проекта
(<https://github.com/Hydro-zz/hh-cover-letter/issues>).

---

# Privacy Policy — HH Cover Letter

Effective date: 15 October 2026. Applies to the HH Cover Letter extension for Chromium-based browsers.

## Summary

- The extension **sends no data to the developer**. There is no analytics, telemetry, advertising or third-party tracking.
- API keys and your resume text are stored **only on your computer**, in the browser's local extension storage.
- The vacancy text and your resume text are transmitted **only to the language-model server you selected yourself** in the
  extension settings. There are no other recipients.
- If you choose a local model (Ollama, LM Studio), no data leaves your computer at all.
- The extension never submits a job application on your behalf — you do that manually.

## What data is processed

| Data | Purpose | Source |
| --- | --- | --- |
| Vacancy text (title, company, description, requirements) | Tailor the letter to this specific vacancy | The hh.ru vacancy page you opened |
| Resume text (each one, if you have several) | Base the letter only on your real experience | Your hh.ru resume pages, or the field in settings |
| Cover letter | The result you review and edit | Generated by the language model on your request |
| Provider API key | Authorise requests to the service you chose | You enter it in settings |
| First and last name for the signature | Sign the letter with your name | Your hh.ru profile page, or the field in settings |
| Settings (provider, model, tone, length, language, notes) | Avoid re-entering them each time | You set them in settings |

## Where data is stored

All of the above, including API keys, is stored in the extension's local storage (`chrome.storage.local`) inside your
browser profile. It is not synced across devices and is not accessible to the developer. The extension never asks for or
reads your hh.ru password.

## Who data is shared with

The only data transfer is the request to the language-model server you selected in settings. That request carries the
vacancy text, your resume text, the name used for the signature and your style preferences; the response carries the
letter text.

- **Cloud providers** (DeepSeek, OpenAI, OpenRouter, Groq, Mistral, Google Gemini and others) — data processing is
  governed by their own policies and terms. Review them before choosing a provider.
- **Local servers** (Ollama, LM Studio, your own network server) — data stays with you. The extension only contacts the
  address you specify.

Your API key is sent only to the provider it belongs to, and only in the request's authorisation header. The extension
does not proxy requests through developer servers and has no backend of its own.

## What the extension does not do

- No usage statistics, crash reporting or tracking identifiers.
- No reading of other tabs or pages: access is limited to hh.ru and only on user action.
- No selling or sharing of data with anyone other than the model provider you selected.
- No submitting job applications on your behalf.
- No advertising.

## Data deletion

Remove the extension in your browser (`chrome://extensions` → Remove) and all stored data, including the API key and
resume text, is deleted with it. Nothing remains on the developer's side, because nothing is stored there.

Data already sent to a model provider is deleted according to that provider's rules: see its privacy policy and account
settings.

## Permissions and why they are needed

| Permission | Purpose |
| --- | --- |
| `storage` | Store settings, key and resume text locally |
| `activeTab` | Access the current tab only on your action (button, popup, keyboard shortcut) |
| `scripting` | Read your resume text from the hh.ru page when you press "Load resume" |
| Access to `hh.ru` | Read vacancy text and insert the letter into the response form |
| Access to model provider domains | Send the request to the service you selected |
| Optional access to an arbitrary domain | For your own OpenAI-compatible server; requested by a button and revocable at any time |

## Children

The extension is not intended for children under 13 and does not collect data about them.

## Policy changes

The current version of this policy always lives in the project repository. Material changes are recorded in
[CHANGELOG.md](./CHANGELOG.md) and shipped with a new extension version.

## Contact

Questions and requests: the project repository's Issues section
(<https://github.com/Hydro-zz/hh-cover-letter/issues>).
