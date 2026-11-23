import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Lock,
  X,
} from 'lucide-react';
import type { AuthorizedUserRecord } from '../types/erp';
import {
  changeOwnUserPassword,
  type ERPUser,
} from '../utils/auth';

interface ChangePasswordModalProps {
  isOpen: boolean;
  currentUser: ERPUser | null;
  stateUsers?: AuthorizedUserRecord[];
  onClose: () => void;
  onUpdateAuthorizedUsers: (users: AuthorizedUserRecord[]) => void;
}

export function ChangePasswordModal({
  isOpen,
  currentUser,
  stateUsers,
  onClose,
  onUpdateAuthorizedUsers,
}: ChangePasswordModalProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setError(null);
    setSuccessMessage(null);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen || !currentUser) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    if (!currentPassword.trim()) {
      setError('Ingresa tu contraseña actual.');
      return;
    }

    if (!newPassword.trim() || newPassword.trim().length < 4) {
      setError('La nueva contraseña debe tener al menos 4 caracteres.');
      return;
    }

    if (newPassword.trim() !== confirmPassword.trim()) {
      setError('Las contraseñas nuevas no coinciden. Verifícalas.');
      return;
    }

    const result = changeOwnUserPassword({
      email: currentUser.email,
      currentPassword,
      newPassword,
      stateUsers,
    });

    if (!result.ok || !result.updatedUsers) {
      setError(result.error ?? 'No se pudo actualizar la contraseña.');
      return;
    }

    onUpdateAuthorizedUsers(result.updatedUsers);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setSuccessMessage(
      'Contraseña actualizada y sincronizada correctamente con Firebase.',
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="change-own-password-title"
      data-testid="change-own-password-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#040812]/85 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#080F1E] p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="rounded-xl border border-blue-500/35 bg-blue-500/15 p-2 text-blue-400">
              <KeyRound className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2
                id="change-own-password-title"
                className="font-display text-base font-bold text-white"
              >
                Cambiar mi contraseña
              </h2>
              <p className="text-[11px] text-slate-400 truncate max-w-[260px]">
                {currentUser.name} · {currentUser.email}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar modal"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {error && (
            <div
              role="alert"
              data-testid="change-own-password-error"
              className="flex items-start gap-2 rounded-xl border border-red-500/35 bg-red-500/10 px-3 py-2.5 text-xs text-red-200"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <span>{error}</span>
            </div>
          )}

          {successMessage && (
            <div
              role="status"
              data-testid="change-own-password-success"
              className="flex items-start gap-2 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3 py-2.5 text-xs text-emerald-200"
            >
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              <span>{successMessage}</span>
            </div>
          )}

          <div>
            <label
              htmlFor="own-current-password"
              className="block text-xs font-medium text-slate-300 mb-1"
            >
              Contraseña actual
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
              <input
                id="own-current-password"
                data-testid="input-own-current-password"
                type="password"
                required
                placeholder="Ingresa tu contraseña actual"
                value={currentPassword}
                onChange={(e) => {
                  setCurrentPassword(e.target.value);
                  setError(null);
                }}
                className="w-full min-h-[40px] rounded-xl border border-slate-700 bg-[#070D19] pl-9 pr-3 py-2 text-xs text-white placeholder:text-slate-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="own-new-password"
              className="block text-xs font-medium text-slate-300 mb-1"
            >
              Nueva contraseña
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
              <input
                id="own-new-password"
                data-testid="input-own-new-password"
                type="password"
                required
                minLength={4}
                placeholder="Mínimo 4 caracteres"
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  setError(null);
                }}
                className="w-full min-h-[40px] rounded-xl border border-slate-700 bg-[#070D19] pl-9 pr-3 py-2 text-xs text-white placeholder:text-slate-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="own-confirm-password"
              className="block text-xs font-medium text-slate-300 mb-1"
            >
              Confirmar contraseña
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
              <input
                id="own-confirm-password"
                data-testid="input-own-confirm-password"
                type="password"
                required
                minLength={4}
                placeholder="Repite la nueva contraseña"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  setError(null);
                }}
                className="w-full min-h-[40px] rounded-xl border border-slate-700 bg-[#070D19] pl-9 pr-3 py-2 text-xs text-white placeholder:text-slate-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[40px] rounded-xl border border-slate-700 bg-[#0D1526] px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800"
            >
              {successMessage ? 'Cerrar' : 'Cancelar'}
            </button>
            <button
              type="submit"
              data-testid="btn-submit-own-password"
              className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-500"
            >
              <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Guardar contraseña</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
