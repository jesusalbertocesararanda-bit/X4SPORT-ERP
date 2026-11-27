import { Monitor, Moon, Sun } from 'lucide-react';
import type { ThemePreference } from '../utils/theme';

interface ThemeSelectorProps {
  value: ThemePreference;
  onChange: (next: ThemePreference) => void;
  showLabels?: 'always' | 'xl' | 'never';
  fullWidth?: boolean;
  testIdPrefix?: string;
}

const OPTIONS: Array<{
  id: ThemePreference;
  label: string;
  title: string;
  icon: typeof Sun;
}> = [
  {
    id: 'light',
    label: 'Claro',
    title: 'Modo Claro / Normal',
    icon: Sun,
  },
  {
    id: 'dark',
    label: 'Oscuro',
    title: 'Modo Oscuro',
    icon: Moon,
  },
  {
    id: 'system',
    label: 'Sistema',
    title: 'Automático según dispositivo / sistema',
    icon: Monitor,
  },
];

export function ThemeSelector({
  value,
  onChange,
  showLabels = 'xl',
  fullWidth = false,
  testIdPrefix = 'theme-selector',
}: ThemeSelectorProps) {
  return (
    <div
      role="group"
      aria-label="Selector de apariencia"
      data-testid={testIdPrefix}
      className={`${
        fullWidth ? 'grid w-full grid-cols-3 gap-0.5' : 'inline-flex items-center'
      } rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-slate-700/90 dark:bg-[#0B1222]`}
    >
      {OPTIONS.map((option) => {
        const Icon = option.icon;
        const isActive = value === option.id;
        return (
          <button
            key={option.id}
            type="button"
            data-testid={`${testIdPrefix}-${option.id}`}
            aria-pressed={isActive}
            aria-label={option.title}
            title={option.title}
            onClick={() => onChange(option.id)}
            className={`inline-flex min-h-[30px] items-center justify-center rounded-md py-1 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
              fullWidth ? 'w-full gap-1 px-1.5' : 'gap-1.5 px-2'
            } ${
              isActive
                ? 'bg-white text-slate-900 shadow-xs dark:bg-blue-600 dark:text-white'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
          >
            <Icon
              className={`h-3.5 w-3.5 shrink-0 ${
                isActive
                  ? option.id === 'light'
                    ? 'text-amber-500 dark:text-amber-300'
                    : option.id === 'dark'
                      ? 'text-blue-600 dark:text-white'
                      : 'text-emerald-600 dark:text-white'
                  : ''
              }`}
              aria-hidden="true"
            />
            {showLabels === 'always' && <span>{option.label}</span>}
            {showLabels === 'xl' && (
              <span className="hidden xl:inline">{option.label}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
