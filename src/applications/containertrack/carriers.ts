/** Deterministic carrier lookup from the ISO 6346 owner code. */

export interface CarrierInfo {
  code: string;
  name: string;
  scac: string;
  website: string;
  trackingPage: string;
}

const OWNER_CODE_CARRIERS: Record<string, CarrierInfo> = {
  MSC: { code: "MSC", name: "Mediterranean Shipping Company", scac: "MSCU", website: "https://www.msc.com", trackingPage: "https://www.msc.com/en/track-a-shipment" },
  MED: { code: "MSC", name: "Mediterranean Shipping Company", scac: "MEDU", website: "https://www.msc.com", trackingPage: "https://www.msc.com/en/track-a-shipment" },
  MAE: { code: "MAERSK", name: "Maersk Line", scac: "MAEU", website: "https://www.maersk.com", trackingPage: "https://www.maersk.com/tracking" },
  MRK: { code: "MAERSK", name: "Maersk Line", scac: "MRKU", website: "https://www.maersk.com", trackingPage: "https://www.maersk.com/tracking" },
  MSK: { code: "MAERSK", name: "Maersk Line", scac: "MSKU", website: "https://www.maersk.com", trackingPage: "https://www.maersk.com/tracking" },
  CMA: { code: "CMACGM", name: "CMA CGM", scac: "CMAU", website: "https://www.cma-cgm.com", trackingPage: "https://www.cma-cgm.com/ebusiness/tracking" },
  CGM: { code: "CMACGM", name: "CMA CGM", scac: "CGMU", website: "https://www.cma-cgm.com", trackingPage: "https://www.cma-cgm.com/ebusiness/tracking" },
  HLC: { code: "HAPAG", name: "Hapag-Lloyd", scac: "HLCU", website: "https://www.hapag-lloyd.com", trackingPage: "https://www.hapag-lloyd.com/en/online-business/track/track-by-container-solution.html" },
  HLX: { code: "HAPAG", name: "Hapag-Lloyd", scac: "HLXU", website: "https://www.hapag-lloyd.com", trackingPage: "https://www.hapag-lloyd.com/en/online-business/track/track-by-container-solution.html" },
  COS: { code: "COSCO", name: "COSCO Shipping Lines", scac: "COSU", website: "https://elines.coscoshipping.com", trackingPage: "https://elines.coscoshipping.com/ebusiness/cargoTracking" },
  CBH: { code: "COSCO", name: "COSCO Shipping Lines", scac: "CBHU", website: "https://elines.coscoshipping.com", trackingPage: "https://elines.coscoshipping.com/ebusiness/cargoTracking" },
  OOL: { code: "OOCL", name: "Orient Overseas Container Line", scac: "OOLU", website: "https://www.oocl.com", trackingPage: "https://www.oocl.com/eng/ourservices/eservices/cargotracking" },
  EGH: { code: "EVERGREEN", name: "Evergreen Line", scac: "EGHU", website: "https://www.evergreen-line.com", trackingPage: "https://www.evergreen-line.com/tracking" },
  EIS: { code: "EVERGREEN", name: "Evergreen Line", scac: "EISU", website: "https://www.evergreen-line.com", trackingPage: "https://www.evergreen-line.com/tracking" },
  EGL: { code: "EVERGREEN", name: "Evergreen Line", scac: "EGLV", website: "https://www.evergreen-line.com", trackingPage: "https://www.evergreen-line.com/tracking" },
  ONE: { code: "ONE", name: "Ocean Network Express", scac: "ONEU", website: "https://ecomm.one-line.com", trackingPage: "https://ecomm.one-line.com/one-ecom/manage-shipment/cargo-tracking" },
  NYK: { code: "ONE", name: "Ocean Network Express", scac: "NYKU", website: "https://ecomm.one-line.com", trackingPage: "https://ecomm.one-line.com/one-ecom/manage-shipment/cargo-tracking" },
  MOL: { code: "ONE", name: "Ocean Network Express", scac: "MOLU", website: "https://ecomm.one-line.com", trackingPage: "https://ecomm.one-line.com/one-ecom/manage-shipment/cargo-tracking" },
  KKL: { code: "ONE", name: "Ocean Network Express", scac: "KKLU", website: "https://ecomm.one-line.com", trackingPage: "https://ecomm.one-line.com/one-ecom/manage-shipment/cargo-tracking" },
  YML: { code: "YANGMING", name: "Yang Ming Marine Transport", scac: "YMLU", website: "https://www.yangming.com", trackingPage: "https://www.yangming.com/e-service/track_trace/track_trace_cargo_tracking.aspx" },
  HMM: { code: "HMM", name: "HMM Co., Ltd.", scac: "HMMU", website: "https://www.hmm21.com", trackingPage: "https://www.hmm21.com/cms/business/ebiz/trackTrace/trackTrace/index.jsp" },
  HDM: { code: "HMM", name: "HMM Co., Ltd.", scac: "HDMU", website: "https://www.hmm21.com", trackingPage: "https://www.hmm21.com/cms/business/ebiz/trackTrace/trackTrace/index.jsp" },
  ZIM: { code: "ZIM", name: "ZIM Integrated Shipping Services", scac: "ZIMU", website: "https://www.zim.com", trackingPage: "https://www.zim.com/tools/track-a-shipment" },
  PCI: { code: "PIL", name: "Pacific International Lines", scac: "PCIU", website: "https://www.pilship.com", trackingPage: "https://www.pilship.com/track-trace" },
  SUD: { code: "HAMBURGSUD", name: "Hamburg Süd", scac: "SUDU", website: "https://www.hamburgsud-line.com", trackingPage: "https://www.hamburgsud-line.com/liner/en/liner_services/ecommerce/track_trace" },
};

/** Container-leasing owner codes: the box owner is not the carrier. */
const LESSOR_CODES = new Set(["TGH", "TRI", "TCN", "TEM", "CAI", "GES", "SEG", "BEA", "FCI", "DFS"]);

export function carrierForOwnerCode(ownerCode: string): CarrierInfo | null {
  return OWNER_CODE_CARRIERS[ownerCode.toUpperCase()] ?? null;
}

export function isLessorOwnerCode(ownerCode: string): boolean {
  return LESSOR_CODES.has(ownerCode.toUpperCase());
}

export function carrierByCode(code: string): CarrierInfo | null {
  const upper = code.toUpperCase();
  return Object.values(OWNER_CODE_CARRIERS).find((c) => c.code === upper || c.scac === upper) ?? null;
}
