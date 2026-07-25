"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-full bg-sage-700 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-sage-600 print:hidden"
    >
      下载 PDF / 打印
    </button>
  );
}
