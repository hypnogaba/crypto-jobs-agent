/** Вакансія так, як її віддало джерело — до будь-якої нормалізації. */
export interface RawJob {
  url: string;
  company: string;
  title: string;
  location: string | null;
  remote: boolean;
  postedAt: string | null;
  source: string;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
  /**
   * Теги, успадковані від компанії. Потрібні, бо коли фірму з крипто-колекції
   * Getro забирають у постійний список, далі її опитують через власний ATS —
   * і ніша губиться, якщо не передати її явно.
   */
  inheritedTags?: string[];
  /** Команда або відділ — те, що ATS справді знає про роль. */
  team?: string | null;
  /** Повна зайнятість, контракт, стажування. */
  commitment?: string | null;
}

export interface NormalizedJob extends RawJob {
  companyKey: string;
  /** Компанія + роль без локації: так геоклони схлопуються в один рядок. */
  dedupeKey: string;
  tags: string[];
  fetchedAt: string;
}

export type SourceStatus = "ok" | "degraded" | "deprecated";

/** Що повертає адаптер. Адаптери не кидають винятків назовні. */
export interface SourceResult {
  source: string;
  ok: boolean;
  jobs: RawJob[];
  error?: string;
  /** Джерело недоступне (блок, пейволл, 404). Це НЕ те саме, що «нічого не знайшли». */
  broken?: boolean;
}

export type AtsProvider =
  | "greenhouse" | "lever" | "ashby" | "workable"
  | "smartrecruiters" | "breezy" | "personio" | "rippling" | "workday"
  | "bamboohr";

export interface Company {
  slug: string;
  name: string;
  atsProvider: AtsProvider | null;
  atsSlug: string | null;
  tags: string[];
  discoveredVia: string | null;
  lastFitAt: string | null;
  lastScannedAt: string | null;
  dryScans: number;
}

export type Rung = "R1" | "R2" | "R3" | "R4" | "R5";
