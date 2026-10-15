export const DEFAULT_SETTINGS = {
  provider: 'deepseek',
  baseUrl: '',
  model: 'deepseek-chat',
  apiKeys: {},
  modelsByProvider: {},
  temperature: 0.7,
  maxTokens: 1400,
  tone: 'friendly',
  length: 'medium',
  language: 'ru',
  extra: '',
  resumeUrl: '',
  resume: ''
};

// Все провайдеры ниже общаются по OpenAI-совместимому протоколу
// (POST {baseUrl}/chat/completions), поэтому отличается только обвязка.
export const PROVIDERS = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    keyUrl: 'https://platform.deepseek.com',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    reasoningFields: ['reasoning_content']
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    keyUrl: 'https://platform.openai.com/api-keys',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-5-mini'],
    // новые модели OpenAI принимают только max_completion_tokens и фиксированную температуру
    tokenParam: 'max_completion_tokens',
    temperature: false,
    reasoningFields: ['reasoning_content', 'reasoning']
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyUrl: 'https://openrouter.ai/keys',
    models: [
      'deepseek/deepseek-chat',
      'openai/gpt-4o-mini',
      'anthropic/claude-3.5-sonnet',
      'google/gemini-2.0-flash-001'
    ],
    reasoningFields: ['reasoning', 'reasoning_content']
  },
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyUrl: 'https://console.groq.com/keys',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
    reasoningFields: ['reasoning', 'reasoning_content']
  },
  {
    id: 'mistral',
    label: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    keyUrl: 'https://console.mistral.ai/api-keys',
    models: ['mistral-large-latest', 'mistral-small-latest', 'open-mistral-nemo'],
    reasoningFields: ['reasoning', 'reasoning_content']
  },
  {
    id: 'gemini',
    label: 'Google Gemini (OpenAI-совместимый)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyUrl: 'https://aistudio.google.com/apikey',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro'],
    tokenParam: 'max_tokens',
    reasoningFields: ['reasoning', 'reasoning_content']
  },
  {
    id: 'ollama',
    label: 'Ollama (локально, без ключа)',
    baseUrl: 'http://localhost:11434/v1',
    keyUrl: '',
    models: ['llama3.2', 'qwen2.5:7b', 'mistral'],
    requiresKey: false,
    reasoningFields: ['reasoning', 'reasoning_content']
  },
  {
    id: 'lmstudio',
    label: 'LM Studio (локально, без ключа)',
    baseUrl: 'http://localhost:1234/v1',
    keyUrl: '',
    models: ['local-model'],
    requiresKey: false,
    reasoningFields: ['reasoning', 'reasoning_content']
  },
  {
    id: 'custom',
    label: 'Свой OpenAI-совместимый сервер',
    baseUrl: '',
    keyUrl: '',
    models: [],
    reasoningFields: ['reasoning_content', 'reasoning']
  }
];

export function normalizeBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch {
    return '';
  }
}

export function resolveProvider(settings) {
  const preset = PROVIDERS.find((item) => item.id === settings?.provider) || PROVIDERS[0];

  const resolved = {
    requiresKey: true,
    tokenParam: 'max_tokens',
    temperature: true,
    reasoningFields: ['reasoning_content', 'reasoning'],
    ...preset
  };

  if (resolved.id === 'custom') {
    resolved.baseUrl = normalizeBaseUrl(settings?.baseUrl);
  }

  return resolved;
}

export function providerEndpoint(provider) {
  return `${provider.baseUrl}/chat/completions`;
}

export function providerApiKey(settings) {
  const provider = resolveProvider(settings);
  return String(settings?.apiKeys?.[provider.id] || '').trim();
}

export function providerModel(settings) {
  return String(settings?.model || '').trim();
}

const TONE_HINTS = {
  friendly: 'дружелюбный и живой, но без панибратства и фамильярности',
  formal: 'официально-деловой, сдержанный',
  concise: 'предельно конкретный: без вступлений, воды и общих слов',
  enthusiastic: 'энергичный, с явным интересом к продукту и задачам компании',
  technical: 'технический: технологии, архитектура, конкретные задачи и результаты'
};

// deepseek-reasoner тратит max_tokens и на рассуждения, и на текст письма,
// поэтому при малом лимите ответ приходит пустым.
export const REASONER_MIN_TOKENS = 8000;

export const isReasonerModel = (model) => /reasoner/i.test(String(model || ''));

export function resolveMaxTokens(settings) {
  const configured = Number(settings?.maxTokens) || 0;
  if (isReasonerModel(settings?.model)) return Math.max(REASONER_MIN_TOKENS, configured);
  return configured || 1400;
}

const LENGTH_HINTS = {
  short: 'до 900 знаков (примерно 6-8 предложений)',
  medium: '1200-1800 знаков (3-4 абзаца)',
  long: '2000-2800 знаков (4-5 абзацев)'
};

export function clip(text, max) {
  const value = String(text ?? '');
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export async function loadSettings() {
  const stored = await chrome.storage.local.get('settings');
  const merged = { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };

  merged.apiKeys = { ...(merged.apiKeys || {}) };
  merged.modelsByProvider = { ...(merged.modelsByProvider || {}) };

  // ключ из версий до выбора провайдера принадлежал DeepSeek
  if (!Object.keys(merged.apiKeys).length && merged.apiKey) {
    merged.apiKeys.deepseek = merged.apiKey;
  }
  delete merged.apiKey;

  return merged;
}

export async function saveSettings(patch) {
  const next = { ...(await loadSettings()), ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

const RESUME_PATH = '/resume/';

export function parseResumeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return { ok: true, url: '' };

  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, reason: 'Это не похоже на ссылку. Нужен адрес вида https://hh.ru/resume/…' };
  }

  if (!/(^|\.)hh\.ru$/i.test(parsed.hostname) || !parsed.pathname.startsWith(RESUME_PATH)) {
    return { ok: false, reason: 'Нужна ссылка на резюме hh.ru вида https://hh.ru/resume/…' };
  }

  parsed.hash = '';
  return { ok: true, url: parsed.href };
}

export function resumeKey(value) {
  try {
    const url = new URL(String(value || ''));
    return `${url.hostname}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return '';
  }
}

export function buildMessages(settings, vacancy, resumeText) {
  const language = settings.language === 'en' ? 'английском' : 'русском';

  const system = [
    'Ты — опытный карьерный консультант. Ты пишешь сопроводительное письмо от первого лица от имени кандидата, который откликается на вакансию на hh.ru.',
    '',
    'Жёсткие правила:',
    `1. Язык письма — ${language}.`,
    '2. Опирайся ТОЛЬКО на факты из резюме кандидата. Ничего не выдумывай: ни опыт, ни компании, ни технологии, ни цифры, которых нет в резюме.',
    '3. Связывай опыт кандидата с конкретными требованиями и задачами из текста вакансии, называя их так, как они названы в вакансии.',
    '4. Не оставляй плейсхолдеров и квадратных скобок вида [Ваше имя] или {{company}}: либо бери данные из резюме и вакансии, либо перестраивай фразу.',
    '5. Без штампов, не подтверждённых резюме: «быстро обучаюсь», «командный игрок», «стрессоустойчив», «легко нахожу общий язык».',
    '6. Без markdown, списков, заголовков и эмодзи — только обычный текст с абзацами.',
    '7. Не оценивай кандидата («идеально подхожу») — приводи факты и результаты.',
    '8. В ответе только текст письма: без темы, пояснений и комментариев.',
    `Тон: ${TONE_HINTS[settings.tone] || TONE_HINTS.friendly}.`,
    `Объём: ${LENGTH_HINTS[settings.length] || LENGTH_HINTS.medium}.`,
    'Начни с приветствия, в первом абзаце укажи позицию, на которую откликается кандидат, и название компании, если оно известно.',
    'В конце — короткая подпись: имя кандидата, если оно есть в резюме, и один контакт из резюме, если он там указан. Контакты не выдумывай.'
  ].join('\n');

  const vacancyText = [
    `Должность: ${vacancy.title || 'не указана'}`,
    `Компания: ${vacancy.company || 'не указана'}`,
    vacancy.salary ? `Зарплата: ${vacancy.salary}` : '',
    vacancy.location ? `Локация: ${vacancy.location}` : '',
    vacancy.employment ? `Формат и опыт: ${vacancy.employment}` : '',
    '',
    'Текст вакансии:',
    vacancy.description || '(не удалось прочитать)'
  ]
    .filter(Boolean)
    .join('\n');

  const extra = String(settings.extra || '').trim();

  const user = [
    '# ВАКАНСИЯ',
    clip(vacancyText, 9000),
    '',
    '# РЕЗЮМЕ КАНДИДАТА',
    clip(resumeText || '(резюме не заполнено)', 9000),
    '',
    '# ПОЖЕЛАНИЯ КАНДИДАТА',
    extra ? clip(extra, 1500) : 'нет дополнительных пожеланий'
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];
}
