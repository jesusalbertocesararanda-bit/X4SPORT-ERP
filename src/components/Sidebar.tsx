import { useState } from 'react';
import {
  BarChart3,
  ChevronDown,
  ChevronRight,
  FileText,
  LayoutDashboard,
  LogOut,
  Monitor,
  Moon,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Store,
  Sun,
  UploadCloud,
  Wallet,
} from 'lucide-react';
import type { SubModuleId } from '../types/erp';
import { canAccessConfiguration, type ERPUser } from '../utils/auth';
import type { ThemePreference } from '../utils/theme';
import { ThemeSelector } from './ThemeSelector';

interface SidebarProps {
  activeSubModule: SubModuleId;
  isCollapsed: boolean;
  mobileOpen: boolean;
  currentUser: ERPUser | null;
  isSynced?: boolean;
  storeName?: string;
  themePreference?: ThemePreference;
  onChangeThemePreference?: (next: ThemePreference) => void;
  onToggleCollapse: () => void;
  onCloseMobile: () => void;
  onSelectSubModule: (subModule: SubModuleId) => void;
  onLogout: () => void;
}

interface TreeBranchNode {
  id: string;
  label: string;
  icon: typeof LayoutDashboard;
  children: Array<{
    id: SubModuleId;
    label: string;
  }>;
}

interface StandaloneNode {
  id: SubModuleId;
  label: string;
  icon: typeof LayoutDashboard;
}

const TREE_MODULES: TreeBranchNode[] = [
  {
    id: 'tree-ventas',
    label: 'Ventas',
    icon: ShoppingBag,
    children: [
      { id: 'ventas-registrar', label: 'Registrar Venta' },
      { id: 'ventas-historial', label: 'Historial de Ventas' },
      { id: 'ventas-devoluciones', label: 'Devoluciones y Cambios' },
      { id: 'ventas-cxc', label: 'Cuentas por Cobrar (CxC)' },
    ],
  },
  {
    id: 'tree-compras',
    label: 'Compras',
    icon: ShoppingCart,
    children: [
      { id: 'compras-registrar', label: 'Registrar Compra / Recepción' },
      { id: 'compras-transito', label: 'Pedidos en Tránsito e Historial' },
      { id: 'compras-precios', label: 'Historial de Precios' },
    ],
  },
  {
    id: 'tree-inventario',
    label: 'Inventario',
    icon: Package,
    children: [
      { id: 'inventario-stock', label: 'Stock Disponible' },
      { id: 'inventario-auditoria', label: 'Auditoría y Conteos' },
      { id: 'inventario-ajustes', label: 'Ajustes de Inventario' },
      { id: 'inventario-movimientos', label: 'Movimientos' },
      { id: 'inventario-reposicion', label: 'Reposición y Pedidos' },
    ],
  },
  {
    id: 'tree-finanzas',
    label: 'Finanzas',
    icon: Wallet,
    children: [
      { id: 'finanzas-matriz', label: 'Matriz de 4 Capas' },
      { id: 'finanzas-gastos', label: 'Gastos (Operativos y Producción)' },
      { id: 'finanzas-socios', label: 'Reparto de Socios' },
      { id: 'finanzas-capital', label: 'Inyección de Capital' },
      { id: 'finanzas-caja', label: 'Cuadre de Caja' },
    ],
  },
];

const STANDALONE_MODULES: StandaloneNode[] = [
  { id: 'reportes', label: 'Reportes', icon: FileText },
  { id: 'estadisticas', label: 'Estadísticas', icon: BarChart3 },
  { id: 'cargas', label: 'Cargas Masivas', icon: UploadCloud },
  { id: 'catalogo', label: 'Catálogo Público', icon: Store },
];

const CONFIG_TREE_MODULE: TreeBranchNode = {
  id: 'tree-configuracion',
  label: 'Configuración',
  icon: Settings,
  children: [
    { id: 'config-matriz-alertas', label: 'Matriz y Alertas' },
    { id: 'config-marca-catalogo', label: 'Marca y Catálogo' },
    { id: 'config-usuarios-seguridad', label: 'Usuarios y Seguridad' },
    { id: 'config-tasas', label: 'Tasas de Cambio' },
    { id: 'config-respaldo', label: 'Respaldo y Datos' },
  ],
};

const SIDEBAR_BRANCHES_STORAGE_KEY = 'x4sport_sidebar_expanded_branches_v1';

const DEFAULT_EXPANDED_BRANCHES: Record<string, boolean> = {
  'tree-ventas': false,
  'tree-compras': false,
  'tree-inventario': false,
  'tree-finanzas': false,
  'tree-configuracion': false,
};

export function Sidebar({
  activeSubModule,
  isCollapsed,
  mobileOpen,
  currentUser,
  storeName = 'X4SPORT',
  themePreference,
  onChangeThemePreference,
  onToggleCollapse,
  onCloseMobile,
  onSelectSubModule,
  onLogout,
}: SidebarProps) {
  const [expandedBranches, setExpandedBranches] = useState<
    Record<string, boolean>
  >(() => {
    try {
      const raw = localStorage.getItem(SIDEBAR_BRANCHES_STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const restored: Record<string, boolean> = {
            ...DEFAULT_EXPANDED_BRANCHES,
          };
          for (const key of Object.keys(DEFAULT_EXPANDED_BRANCHES)) {
            const val = (parsed as Record<string, unknown>)[key];
            if (typeof val === 'boolean') {
              restored[key] = val;
            }
          }
          return restored;
        }
      }
    } catch {
      // Ignore storage errors
    }
    return { ...DEFAULT_EXPANDED_BRANCHES };
  });

  const toggleBranch = (branchId: string) => {
    setExpandedBranches((prev) => {
      const next = {
        ...prev,
        [branchId]: !prev[branchId],
      };
      try {
        localStorage.setItem(
          SIDEBAR_BRANCHES_STORAGE_KEY,
          JSON.stringify(next),
        );
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  };

  const handleNavigate = (subModule: SubModuleId) => {
    onSelectSubModule(subModule);
    onCloseMobile();
  };

  const canSeeConfig = canAccessConfiguration(currentUser);
  const visibleTreeModules: TreeBranchNode[] = canSeeConfig
    ? [...TREE_MODULES, CONFIG_TREE_MODULE]
    : TREE_MODULES;

  return (
    <>
      {mobileOpen && (
        <div
          aria-hidden="true"
          onClick={onCloseMobile}
          className="fixed inset-0 z-40 bg-black/75 backdrop-blur-xs lg:hidden"
        />
      )}

      <aside
        data-testid="app-sidebar"
        aria-label="Navegación lateral X4SPORT"
        className={`fixed inset-y-0 left-0 z-50 flex flex-col border-r border-slate-200 bg-white dark:border-slate-800/90 dark:bg-[#080F1E] transition-all duration-300 ease-in-out lg:sticky lg:top-0 lg:h-screen lg:shrink-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        } ${isCollapsed ? 'w-72 lg:w-[74px]' : 'w-72'}`}
      >
        {/* Esquina superior izquierda: Toggle colapsable + Brand */}
        <div
          className={`flex h-16 items-center border-b border-slate-200 dark:border-slate-800/80 px-3 ${
            isCollapsed ? 'justify-between lg:justify-center' : 'justify-between'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              data-testid="btn-toggle-sidebar"
              onClick={onToggleCollapse}
              title={
                isCollapsed
                  ? 'Desplegar barra lateral'
                  : 'Ocultar / contraer barra lateral'
              }
              aria-label={
                isCollapsed ? 'Desplegar barra lateral' : 'Ocultar barra lateral'
              }
              className="hidden lg:inline-flex min-h-[38px] min-w-[38px] shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-800 dark:bg-[#0D1526] dark:text-slate-300 dark:hover:border-slate-700 dark:hover:bg-slate-800 dark:hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              {isCollapsed ? (
                <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
              ) : (
                <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
              )}
            </button>

            <a
              href="#dashboard"
              onClick={(e) => {
                e.preventDefault();
                handleNavigate('dashboard');
              }}
              className={`font-display text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded ${
                isCollapsed ? 'lg:hidden' : ''
              }`}
            >
              {storeName === 'X4SPORT' ? (
                <>
                  X4<span className="text-blue-600 dark:text-blue-400">SPORT</span>
                </>
              ) : (
                storeName
              )}
            </a>
          </div>

          <button
            type="button"
            onClick={onCloseMobile}
            title="Ocultar menú lateral"
            aria-label="Ocultar menú lateral"
            className="inline-flex lg:hidden min-h-[38px] min-w-[38px] items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-800 dark:bg-[#0D1526] dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white active:-translate-x-0.5 transition-transform"
          >
            <PanelLeftClose className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Árbol jerárquico de módulos y sub-módulos */}
        <nav
          aria-label="Árbol de módulos del sistema"
          className="flex-1 overflow-y-auto px-2.5 py-3.5 space-y-2"
        >
          {/* Panel Principal */}
          <button
            type="button"
            data-testid="nav-item-dashboard"
            title="Panel Principal"
            aria-label="Panel Principal"
            aria-current={activeSubModule === 'dashboard' ? 'page' : undefined}
            onClick={() => handleNavigate('dashboard')}
            className={`flex min-h-[40px] w-full items-center rounded-lg border text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
              isCollapsed
                ? 'justify-center px-2 lg:h-10 lg:w-10 lg:mx-auto lg:px-0'
                : 'gap-2.5 px-3 py-2'
            } ${
              activeSubModule === 'dashboard'
                ? 'border-blue-500/35 bg-blue-50 text-blue-700 dark:border-blue-500/40 dark:bg-blue-600/15 dark:text-white'
                : 'border-transparent text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/60 dark:hover:text-white'
            }`}
          >
            <LayoutDashboard
              className={`h-4 w-4 shrink-0 ${
                activeSubModule === 'dashboard'
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
              aria-hidden="true"
            />
            <span className={isCollapsed ? 'lg:hidden' : 'truncate'}>
              Panel Principal
            </span>
          </button>

          {/* Árboles desplegables: Ventas, Compras, Inventario, Finanzas (+ Configuración para Admin) */}
          <div className="space-y-1.5 pt-1">
            {visibleTreeModules.map((branch) => {
              const Icon = branch.icon;
              const isBranchActive =
                branch.children.some((c) => c.id === activeSubModule) ||
                (branch.id === 'tree-configuracion' &&
                  activeSubModule === 'configuracion');
              const isOpen = expandedBranches[branch.id] ?? false;

              if (isCollapsed) {
                return (
                  <div
                    key={branch.id}
                    className="hidden lg:flex justify-center"
                  >
                    <button
                      type="button"
                      data-testid={`nav-branch-collapsed-${branch.id}`}
                      title={`${branch.label} (clic para abrir)`}
                      aria-label={branch.label}
                      onClick={() => {
                        onToggleCollapse();
                        setExpandedBranches((prev) => {
                          const next = {
                            ...prev,
                            [branch.id]: true,
                          };
                          try {
                            localStorage.setItem(
                              SIDEBAR_BRANCHES_STORAGE_KEY,
                              JSON.stringify(next),
                            );
                          } catch {
                            // Ignore storage errors
                          }
                          return next;
                        });
                      }}
                      className={`flex h-10 w-10 items-center justify-center rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                        isBranchActive
                          ? 'border-blue-500/40 bg-blue-50 text-blue-700 dark:bg-blue-600/20 dark:text-blue-300'
                          : 'border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-100'
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    </button>
                  </div>
                );
              }

              return (
                <div key={branch.id} className="space-y-1">
                  <button
                    type="button"
                    data-testid={`tree-branch-${branch.id}`}
                    aria-expanded={isOpen}
                    onClick={() => toggleBranch(branch.id)}
                    className={`flex min-h-[38px] w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                      isBranchActive
                        ? 'bg-slate-100 text-slate-900 dark:bg-slate-800/60 dark:text-white'
                        : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-800/40 dark:hover:text-white'
                    }`}
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <Icon
                        className={`h-4 w-4 shrink-0 ${
                          isBranchActive ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400'
                        }`}
                        aria-hidden="true"
                      />
                      <span className="truncate">{branch.label}</span>
                    </span>
                    {isOpen ? (
                      <ChevronDown
                        className="h-3.5 w-3.5 shrink-0 text-slate-500 dark:text-slate-400"
                        aria-hidden="true"
                      />
                    ) : (
                      <ChevronRight
                        className="h-3.5 w-3.5 shrink-0 text-slate-500 dark:text-slate-400"
                        aria-hidden="true"
                      />
                    )}
                  </button>

                  {isOpen && (
                    <div className="ml-[19px] border-l border-slate-200 dark:border-slate-700/80 pl-3 space-y-1 py-0.5">
                      {branch.children.map((child) => {
                        const childActive = activeSubModule === child.id;
                        return (
                          <button
                            key={child.id}
                            type="button"
                            data-testid={`nav-item-${child.id}`}
                            aria-current={childActive ? 'page' : undefined}
                            onClick={() => handleNavigate(child.id)}
                            className={`relative flex min-h-[34px] w-full items-center rounded-lg border px-2.5 py-1.5 text-left text-[11.5px] font-medium transition-colors before:content-[''] before:absolute before:-left-3 before:top-1/2 before:h-px before:w-2.5 before:bg-slate-200 dark:before:bg-slate-700/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                              childActive
                                ? 'border-blue-500/35 bg-blue-50 text-blue-700 dark:border-blue-500/40 dark:bg-blue-600/15 dark:text-blue-200 font-semibold'
                                : 'border-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/50 dark:hover:text-slate-100'
                            }`}
                          >
                            <span className="truncate">{child.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Módulos independientes: Reportes, Estadísticas, Cargas Masivas, Catálogo Público */}
          <div className="border-t border-slate-200 dark:border-slate-800/70 pt-2.5 space-y-1">
            {STANDALONE_MODULES.map((item) => {
              const Icon = item.icon;
              const active = activeSubModule === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  data-testid={`nav-item-${item.id}`}
                  title={item.label}
                  aria-label={item.label}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => handleNavigate(item.id)}
                  className={`flex min-h-[38px] w-full items-center rounded-lg border text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                    isCollapsed
                      ? 'justify-center px-2 lg:h-10 lg:w-10 lg:mx-auto lg:px-0'
                      : 'gap-2.5 px-3 py-2'
                  } ${
                    active
                      ? 'border-blue-500/35 bg-blue-50 text-blue-700 dark:border-blue-500/40 dark:bg-blue-600/15 dark:text-white'
                      : 'border-transparent text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/60 dark:hover:text-white'
                  }`}
                >
                  <Icon
                    className={`h-4 w-4 shrink-0 ${
                      active ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400'
                    }`}
                    aria-hidden="true"
                  />
                  <span className={isCollapsed ? 'lg:hidden' : 'truncate'}>
                    {item.label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Apariencia (debajo de Catálogo Público) */}
          {themePreference && onChangeThemePreference && (
            !isCollapsed || mobileOpen ? (
              <div
                data-testid="sidebar-appearance-section"
                className="mt-3 pt-3 border-t border-slate-200/80 dark:border-slate-800/80 px-1 space-y-1.5"
              >
                <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Apariencia
                </p>
                <ThemeSelector
                  value={themePreference}
                  onChange={onChangeThemePreference}
                  showLabels="always"
                  fullWidth
                  testIdPrefix="sidebar-theme-selector"
                />
              </div>
            ) : (
              <div
                data-testid="sidebar-appearance-collapsed"
                className="hidden lg:flex justify-center mt-3 pt-3 border-t border-slate-200/80 dark:border-slate-800/80"
              >
                <button
                  type="button"
                  data-testid="sidebar-theme-cycle-btn"
                  onClick={() => {
                    const order: ThemePreference[] = ['light', 'dark', 'system'];
                    const idx = order.indexOf(themePreference);
                    onChangeThemePreference(order[(idx + 1) % order.length]);
                  }}
                  title={`Apariencia: ${
                    themePreference === 'light'
                      ? 'Claro'
                      : themePreference === 'dark'
                        ? 'Oscuro'
                        : 'Sistema'
                  } (clic para cambiar)`}
                  aria-label="Cambiar apariencia"
                  className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:border-slate-800 dark:bg-[#0D1526] dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  {themePreference === 'light' ? (
                    <Sun className="h-4 w-4 text-amber-500" aria-hidden="true" />
                  ) : themePreference === 'dark' ? (
                    <Moon className="h-4 w-4 text-blue-400" aria-hidden="true" />
                  ) : (
                    <Monitor className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                  )}
                </button>
              </div>
            )
          )}
        </nav>

        {/* Footer de Sidebar: Cerrar Sesión */}
        {currentUser && (
          <div className="mt-auto border-t border-slate-200 dark:border-slate-800/90 p-2.5">
            <button
              type="button"
              data-testid="btn-logout"
              onClick={() => {
                onCloseMobile();
                onLogout();
              }}
              title="Cerrar Sesión"
              aria-label="Cerrar Sesión"
              className={`flex min-h-[36px] w-full items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-red-50 text-xs font-semibold text-red-700 transition-colors hover:bg-red-100 hover:text-red-900 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-200 dark:hover:bg-red-500/20 dark:hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 ${
                isCollapsed ? 'lg:mx-auto lg:h-9 lg:w-9 lg:px-0' : 'px-3 py-1.5'
              }`}
            >
              <LogOut
                className="h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400"
                aria-hidden="true"
              />
              <span className={isCollapsed ? 'lg:hidden' : ''}>
                Cerrar Sesión
              </span>
            </button>
          </div>
        )}
      </aside>
    </>
  );
}
