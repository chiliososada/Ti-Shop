export function EmailField() {
  return (
    <label className="block text-sm font-semibold text-strong">
      Email address
      <input
        className="mt-2 w-full rounded-xl border border-ink-900/15 bg-base px-4 py-3 font-normal text-strong outline-none transition focus:border-sage-500 focus:ring-2 focus:ring-sage-200"
        type="email"
        name="email"
        autoComplete="email"
        inputMode="email"
        required
        maxLength={320}
      />
    </label>
  );
}

export function PasswordField({ newPassword = false }: { newPassword?: boolean }) {
  return (
    <label className="block text-sm font-semibold text-strong">
      Password
      <input
        className="mt-2 w-full rounded-xl border border-ink-900/15 bg-base px-4 py-3 font-normal text-strong outline-none transition focus:border-sage-500 focus:ring-2 focus:ring-sage-200"
        type="password"
        name="password"
        autoComplete={newPassword ? "new-password" : "current-password"}
        required
        minLength={12}
        maxLength={128}
      />
      {newPassword ? (
        <span className="mt-2 block text-caption font-normal text-muted">
          Use 12–128 characters. A password manager is recommended.
        </span>
      ) : null}
    </label>
  );
}
