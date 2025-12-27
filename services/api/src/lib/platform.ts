/**
 * Platform Detection & MLX Support for Ronald-GI
 *
 * Enables automatic platform detection and model selection:
 * - macOS with Apple Silicon: Use MLX for local inference
 * - macOS Intel / Linux / Windows: Use Ollama or remote inference
 *
 * This allows the system to run optimally on any platform.
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { platform, arch, cpus } from 'os';

// ============================================
// TYPES
// ============================================

export type Platform = 'macos-arm' | 'macos-intel' | 'linux' | 'windows' | 'unknown';
export type InferenceBackend = 'mlx' | 'ollama' | 'openai' | 'anthropic' | 'local-transformers';

export interface PlatformInfo {
  platform: Platform;
  arch: string;
  cpuModel: string;
  hasAppleSilicon: boolean;
  hasNvidia: boolean;
  hasMPS: boolean; // Metal Performance Shaders
  recommendedBackend: InferenceBackend;
  mlxAvailable: boolean;
  ollamaAvailable: boolean;
}

export interface ModelConfig {
  backend: InferenceBackend;
  modelName: string;
  endpoint?: string;
  contextLength: number;
  supportsToolUse: boolean;
}

// ============================================
// PLATFORM DETECTION
// ============================================

/**
 * Detect the current platform and its capabilities
 */
export function detectPlatform(): PlatformInfo {
  const os = platform();
  const architecture = arch();
  const cpu = cpus()[0]?.model || 'unknown';

  // Determine platform type
  let platformType: Platform = 'unknown';
  let hasAppleSilicon = false;
  let hasMPS = false;

  if (os === 'darwin') {
    if (architecture === 'arm64') {
      platformType = 'macos-arm';
      hasAppleSilicon = true;
      hasMPS = true;
    } else {
      platformType = 'macos-intel';
    }
  } else if (os === 'linux') {
    platformType = 'linux';
  } else if (os === 'win32') {
    platformType = 'windows';
  }

  // Check for NVIDIA GPU
  const hasNvidia = checkNvidiaGpu();

  // Check MLX availability
  const mlxAvailable = checkMlxAvailable(hasAppleSilicon);

  // Check Ollama availability
  const ollamaAvailable = checkOllamaAvailable();

  // Determine recommended backend
  let recommendedBackend: InferenceBackend = 'ollama';
  if (mlxAvailable) {
    recommendedBackend = 'mlx';
  } else if (ollamaAvailable) {
    recommendedBackend = 'ollama';
  } else if (hasNvidia) {
    recommendedBackend = 'local-transformers';
  }

  return {
    platform: platformType,
    arch: architecture,
    cpuModel: cpu,
    hasAppleSilicon,
    hasNvidia,
    hasMPS,
    recommendedBackend,
    mlxAvailable,
    ollamaAvailable,
  };
}

/**
 * Check if NVIDIA GPU is available
 */
function checkNvidiaGpu(): boolean {
  try {
    execSync('nvidia-smi', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if MLX is available (macOS Apple Silicon only)
 */
function checkMlxAvailable(hasAppleSilicon: boolean): boolean {
  if (!hasAppleSilicon) return false;

  try {
    // Check if mlx Python package is installed
    execSync('python3 -c "import mlx"', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if Ollama is available
 */
function checkOllamaAvailable(): boolean {
  try {
    execSync('ollama --version', { stdio: 'ignore' });
    return true;
  } catch {
    // Check if running as service
    try {
      execSync('curl -s http://localhost:11434/api/tags', { stdio: 'ignore', timeout: 2000 });
      return true;
    } catch {
      return false;
    }
  }
}

// ============================================
// MODEL CONFIGURATION
// ============================================

/**
 * Get the recommended model configuration for the current platform
 */
export function getRecommendedModelConfig(): ModelConfig {
  const platform = detectPlatform();

  if (platform.mlxAvailable) {
    return {
      backend: 'mlx',
      modelName: 'mlx-community/Qwen2.5-7B-Instruct-4bit',
      endpoint: 'http://localhost:8080/v1',
      contextLength: 32768,
      supportsToolUse: true,
    };
  }

  if (platform.ollamaAvailable) {
    return {
      backend: 'ollama',
      modelName: 'qwen2.5:7b',
      endpoint: 'http://localhost:11434',
      contextLength: 32768,
      supportsToolUse: true,
    };
  }

  // Fallback to Anthropic API
  return {
    backend: 'anthropic',
    modelName: 'claude-3-5-sonnet-20241022',
    endpoint: 'https://api.anthropic.com',
    contextLength: 200000,
    supportsToolUse: true,
  };
}

/**
 * Get model configuration for a specific backend
 */
export function getModelConfig(backend: InferenceBackend): ModelConfig {
  switch (backend) {
    case 'mlx':
      return {
        backend: 'mlx',
        modelName: 'mlx-community/Qwen2.5-7B-Instruct-4bit',
        endpoint: 'http://localhost:8080/v1',
        contextLength: 32768,
        supportsToolUse: true,
      };

    case 'ollama':
      return {
        backend: 'ollama',
        modelName: 'qwen2.5:7b',
        endpoint: 'http://localhost:11434',
        contextLength: 32768,
        supportsToolUse: true,
      };

    case 'openai':
      return {
        backend: 'openai',
        modelName: 'gpt-4-turbo-preview',
        endpoint: 'https://api.openai.com/v1',
        contextLength: 128000,
        supportsToolUse: true,
      };

    case 'anthropic':
      return {
        backend: 'anthropic',
        modelName: 'claude-3-5-sonnet-20241022',
        endpoint: 'https://api.anthropic.com',
        contextLength: 200000,
        supportsToolUse: true,
      };

    case 'local-transformers':
      return {
        backend: 'local-transformers',
        modelName: 'Qwen/Qwen2.5-7B-Instruct',
        contextLength: 32768,
        supportsToolUse: false,
      };

    default:
      return getRecommendedModelConfig();
  }
}

// ============================================
// MLX SERVER MANAGEMENT
// ============================================

export interface MlxServerConfig {
  model: string;
  port: number;
  host: string;
  cacheLimit: number; // GB
}

/**
 * Get MLX server startup command
 */
export function getMlxServerCommand(config?: Partial<MlxServerConfig>): string {
  const defaults: MlxServerConfig = {
    model: 'mlx-community/Qwen2.5-7B-Instruct-4bit',
    port: 8080,
    host: '127.0.0.1',
    cacheLimit: 8,
  };

  const cfg = { ...defaults, ...config };

  return `mlx_lm.server --model "${cfg.model}" --port ${cfg.port} --host ${cfg.host} --cache-limit-gb ${cfg.cacheLimit}`;
}

/**
 * Check if MLX server is running
 */
export async function isMlxServerRunning(port: number = 8080): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${port}/v1/models`);
    return response.ok;
  } catch {
    return false;
  }
}

// ============================================
// ENVIRONMENT SETUP HELPERS
// ============================================

/**
 * Get setup instructions for the current platform
 */
export function getSetupInstructions(): string[] {
  const platform = detectPlatform();
  const instructions: string[] = [];

  instructions.push(`Detected platform: ${platform.platform} (${platform.arch})`);
  instructions.push(`Recommended backend: ${platform.recommendedBackend}`);
  instructions.push('');

  if (platform.platform === 'macos-arm') {
    if (!platform.mlxAvailable) {
      instructions.push('To enable MLX (recommended for Apple Silicon):');
      instructions.push('  pip install mlx mlx-lm');
      instructions.push('');
    }
    instructions.push('To start MLX server:');
    instructions.push(`  ${getMlxServerCommand()}`);
    instructions.push('');
  }

  if (!platform.ollamaAvailable) {
    instructions.push('To install Ollama (alternative):');
    if (platform.platform.startsWith('macos')) {
      instructions.push('  brew install ollama');
    } else if (platform.platform === 'linux') {
      instructions.push('  curl -fsSL https://ollama.com/install.sh | sh');
    } else {
      instructions.push('  Download from https://ollama.com');
    }
    instructions.push('');
  }

  return instructions;
}

/**
 * Print platform info to console
 */
export function printPlatformInfo(): void {
  const platform = detectPlatform();

  console.log('\n=== Ronald-GI Platform Detection ===');
  console.log(`Platform: ${platform.platform}`);
  console.log(`Architecture: ${platform.arch}`);
  console.log(`CPU: ${platform.cpuModel}`);
  console.log(`Apple Silicon: ${platform.hasAppleSilicon ? 'Yes' : 'No'}`);
  console.log(`NVIDIA GPU: ${platform.hasNvidia ? 'Yes' : 'No'}`);
  console.log(`Metal (MPS): ${platform.hasMPS ? 'Yes' : 'No'}`);
  console.log(`MLX Available: ${platform.mlxAvailable ? 'Yes' : 'No'}`);
  console.log(`Ollama Available: ${platform.ollamaAvailable ? 'Yes' : 'No'}`);
  console.log(`Recommended Backend: ${platform.recommendedBackend}`);
  console.log('=====================================\n');

  if (!platform.mlxAvailable && !platform.ollamaAvailable) {
    console.log('Setup instructions:');
    getSetupInstructions().forEach(line => console.log(line));
  }
}

// ============================================
// EXPORTS
// ============================================

export default {
  detectPlatform,
  getRecommendedModelConfig,
  getModelConfig,
  getMlxServerCommand,
  isMlxServerRunning,
  getSetupInstructions,
  printPlatformInfo,
};
