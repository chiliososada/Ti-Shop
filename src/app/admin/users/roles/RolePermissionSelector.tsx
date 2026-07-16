"use client";

import { useState } from "react";

type PermissionOption = {
  slug: string;
  name: string;
  description: string | null;
  actorGranted?: boolean;
  selected?: boolean;
};

export function RolePermissionSelector({
  options,
}: {
  options: PermissionOption[];
}) {
  const [selected, setSelected] = useState(
    () =>
      new Set(
        options
          .filter((option) => option.selected || option.slug === "admin.access")
          .map(({ slug }) => slug),
      ),
  );
  const serialized = JSON.stringify([...selected].sort());

  return (
    <fieldset>
      <legend className="text-sm font-semibold text-strong">Permissions</legend>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        You can grant only permissions your current administrator account holds.
        Administration access is required and cannot be removed.
      </p>
      <input type="hidden" name="permissionSlugs" value={serialized} />
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {options.map((permission) => {
          const checked = selected.has(permission.slug);
          const unavailable = permission.actorGranted === false;
          const required = permission.slug === "admin.access";
          return (
            <label
              key={permission.slug}
              className={`rounded-xl border p-4 ${
                unavailable
                  ? "border-ink-900/[0.05] bg-surface-alt opacity-60"
                  : "border-ink-900/[0.08] bg-white"
              }`}
            >
              <span className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={unavailable || required}
                  onChange={(event) => {
                    setSelected((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(permission.slug);
                      else next.delete(permission.slug);
                      return next;
                    });
                  }}
                  className="mt-1 size-4 accent-sage-700"
                />
                <span>
                  <span className="block font-semibold text-strong">
                    {permission.name}
                  </span>
                  <span className="mt-1 block font-mono text-xs text-muted">
                    {permission.slug}
                  </span>
                  {permission.description ? (
                    <span className="mt-2 block text-xs leading-relaxed text-muted">
                      {permission.description}
                    </span>
                  ) : null}
                  {unavailable ? (
                    <span className="mt-2 block text-xs text-clay-700">
                      Your account does not hold this permission.
                    </span>
                  ) : null}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
