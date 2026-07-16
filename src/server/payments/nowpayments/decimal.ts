type ParsedDecimal = {
  coefficient: bigint;
  scale: number;
};

function powerOfTen(exponent: number) {
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > 1_000) {
    throw new Error("Decimal exponent is outside the supported range.");
  }
  return BigInt(`1${"0".repeat(exponent)}`);
}

export function parseDecimal(value: string): ParsedDecimal {
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/u.exec(
    value.trim(),
  );
  if (!match) {
    throw new Error("Invalid decimal value.");
  }

  const sign = match[1] === "-" ? BigInt(-1) : BigInt(1);
  const integer = match[2];
  const fraction = match[3] ?? "";
  const exponent = Number(match[4] ?? "0");
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1_000) {
    throw new Error("Decimal exponent is outside the supported range.");
  }

  let digits = `${integer}${fraction}`.replace(/^0+(?=\d)/u, "");
  let scale = fraction.length - exponent;
  if (scale < 0) {
    digits += "0".repeat(-scale);
    scale = 0;
  }

  while (scale > 0 && digits.endsWith("0")) {
    digits = digits.slice(0, -1);
    scale -= 1;
  }

  const coefficient = BigInt(digits || "0") * sign;
  return {
    coefficient: coefficient === BigInt(0) ? BigInt(0) : coefficient,
    scale,
  };
}

export function compareDecimal(left: string, right: string) {
  const a = parseDecimal(left);
  const b = parseDecimal(right);
  const scale = Math.max(a.scale, b.scale);
  const aCoefficient = a.coefficient * powerOfTen(scale - a.scale);
  const bCoefficient = b.coefficient * powerOfTen(scale - b.scale);
  return aCoefficient < bCoefficient
    ? -1
    : aCoefficient > bCoefficient
      ? 1
      : 0;
}

export function positiveDecimalOrNull(value: string | null | undefined) {
  if (value === null || value === undefined) return null;
  return compareDecimal(value, "0") > 0 ? value : null;
}

export function usdDecimalToMinor(value: string): bigint {
  const parsed = parseDecimal(value);
  if (parsed.coefficient < BigInt(0)) {
    throw new Error("USD amount cannot be negative.");
  }
  if (parsed.scale > 2) {
    throw new Error("USD amount has more than two decimal places.");
  }
  return parsed.coefficient * powerOfTen(2 - parsed.scale);
}

export function usdMinorToNumber(value: bigint): number {
  if (value < BigInt(0) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("USD minor amount is outside the supported API range.");
  }
  const result = Number(value) / 100;
  if (!Number.isFinite(result) || usdDecimalToMinor(result.toFixed(2)) !== value) {
    throw new Error("USD amount cannot be represented exactly for the provider.");
  }
  return result;
}

export function usdMinorToDecimalString(value: bigint): string {
  if (value < BigInt(0)) {
    throw new Error("USD amount cannot be negative.");
  }
  const dollars = value / BigInt(100);
  const cents = (value % BigInt(100)).toString().padStart(2, "0");
  return `${dollars.toString()}.${cents}`;
}
