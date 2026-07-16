export type AddressDefaultFlags = {
  isDefaultShipping: boolean;
  isDefaultBilling: boolean;
};

/** The first active address remains useful even when the customer misses both checkboxes. */
export function defaultsForCreatedAddress(
  activeAddressCount: number,
  requested: AddressDefaultFlags,
): AddressDefaultFlags {
  if (activeAddressCount === 0) {
    return { isDefaultShipping: true, isDefaultBilling: true };
  }

  return requested;
}

/** A replacement address inherits only the default roles held by the removed address. */
export function defaultsToTransferAfterDelete(
  removed: AddressDefaultFlags,
): AddressDefaultFlags {
  return {
    isDefaultShipping: removed.isDefaultShipping,
    isDefaultBilling: removed.isDefaultBilling,
  };
}
