// src/cli.ts
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from './i18n.js';
import { config } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getVersion(): string {
  try {
    const pkgPath = resolve(__dirname, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

function printHelp(): void {
  console.log(`Newscrux — AI-powered news aggregator with push notifications

Usage: newscrux [options]

  Options:
  -l, --lang <code>      Summary language: ${SUPPORTED_LANGUAGES.join(', ')} (default: "en")
  -p, --provider <type>  AI provider: openrouter, ollama (default: "openrouter")
  --no-push              Skip Pushover notifications, show results in terminal only
  --web                  Start web server for feed management
  --port <number>         Web server port (default: 3000)
  -h, --help             Show this help message
  -v, --version          Show version number

Environment variables (.env):
  AI_PROVIDER            AI provider: openrouter, ollama (default: openrouter)
  OPENROUTER_API_KEY    OpenRouter API key (required if provider=openrouter)
  OPENROUTER_MODEL      AI model (default: deepseek/deepseek-v3.2-speciale)
  OLLAMA_BASE_URL       Ollama API URL (default: http://localhost:11434/v1)
  OLLAMA_MODEL          Ollama model name (default: deepseek-qwen-8b:latest)
  PUSHOVER_USER_KEY     Pushover user key (required)
  PUSHOVER_APP_TOKEN    Pushover app token (required)
  POLL_INTERVAL_MINUTES Poll interval in minutes (default: 15)

Examples:
  newscrux --lang=tr      Start with Turkish summaries
  newscrux -l de          Start with German summaries
  newscrux -p ollama      Use local Ollama model
  newscrux --no-push      Run once, show results in terminal only
  newscrux --web          Start web server for feed management
  newscrux --web --port 8080  Start web server on port 8080
  newscrux              Start with English summaries (default)`);
}

export function parseArgs(): { lang: SupportedLanguage; provider: 'openrouter' | 'ollama'; noPush: boolean; web: boolean; port: number } {
  const args = process.argv.slice(2);
  let lang: SupportedLanguage = 'en';
  let provider: 'openrouter' | 'ollama' = config.aiProvider;
  let noPush = false;
  let web = false;
  let port = 3000;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    }

    if (arg === '-v' || arg === '--version') {
      console.log(getVersion());
      process.exit(0);
    }

    // --lang=xx format
    if (arg.startsWith('--lang=')) {
      const value = arg.split('=')[1];
      if (!SUPPORTED_LANGUAGES.includes(value as SupportedLanguage)) {
        console.error(`Error: Unsupported language "${value}". Supported: ${SUPPORTED_LANGUAGES.join(', ')}`);
        process.exit(1);
      }
      lang = value as SupportedLanguage;
      continue;
    }

    // --lang xx or -l xx format
    if (arg === '--lang' || arg === '-l') {
      const value = args[i + 1];
      if (!value || value.startsWith('-')) {
        console.error(`Error: --lang requires a language code. Supported: ${SUPPORTED_LANGUAGES.join(', ')}`);
        process.exit(1);
      }
      if (!SUPPORTED_LANGUAGES.includes(value as SupportedLanguage)) {
        console.error(`Error: Unsupported language "${value}". Supported: ${SUPPORTED_LANGUAGES.join(', ')}`);
        process.exit(1);
      }
      lang = value as SupportedLanguage;
      i++; // skip next arg (the value)
      continue;
    }

    // --provider=xx format
    if (arg.startsWith('--provider=')) {
      const value = arg.split('=')[1];
      if (value !== 'openrouter' && value !== 'ollama') {
        console.error(`Error: Unsupported provider "${value}". Supported: openrouter, ollama`);
        process.exit(1);
      }
      provider = value as 'openrouter' | 'ollama';
      continue;
    }

    // --provider xx or -p xx format
    if (arg === '--provider' || arg === '-p') {
      const value = args[i + 1];
      if (!value || value.startsWith('-')) {
        console.error(`Error: --provider requires a provider. Supported: openrouter, ollama`);
        process.exit(1);
      }
      if (value !== 'openrouter' && value !== 'ollama') {
        console.error(`Error: Unsupported provider "${value}". Supported: openrouter, ollama`);
        process.exit(1);
      }
      provider = value as 'openrouter' | 'ollama';
      i++; // skip next arg (the value)
      continue;
    }

    // --no-push flag
    if (arg === '--no-push') {
      noPush = true;
      continue;
    }

    // --web flag
    if (arg === '--web') {
      web = true;
      continue;
    }

    // --port=xx format
    if (arg.startsWith('--port=')) {
      const value = parseInt(arg.split('=')[1], 10);
      if (isNaN(value) || value < 1 || value > 65535) {
        console.error(`Error: Invalid port number "${value}". Must be between 1 and 65535.`);
        process.exit(1);
      }
      port = value;
      continue;
    }

    // --port xx format
    if (arg === '--port') {
      const value = args[i + 1];
      if (!value || value.startsWith('-')) {
        console.error(`Error: --port requires a port number.`);
        process.exit(1);
      }
      const portNum = parseInt(value, 10);
      if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
        console.error(`Error: Invalid port number "${portNum}". Must be between 1 and 65535.`);
        process.exit(1);
      }
      port = portNum;
      i++;
      continue;
    }
  }

  return { lang, provider, noPush, web, port };
}
