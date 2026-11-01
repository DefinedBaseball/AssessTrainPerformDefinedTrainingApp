'use client';

/* Loads Settings → Programs once per page load and keeps every component that
 * draws facility colours / names / weeks in step with it. The list lives in
 * lib/facility-schedule.ts's registry (plain functions read it); this hook
 * fills it and re-renders its caller when it changes. */

import { useEffect, useState } from 'react';
import * as api from './api';
import { type FacilityProgram, getFacilityPrograms, setFacilityPrograms } from './facility-schedule';

let inflight: Promise<FacilityProgram[]> | null = null;
let loaded = false;
const listeners = new Set<(list: FacilityProgram[]) => void>();

function publish(list: FacilityProgram[]) {
  setFacilityPrograms(list);
  loaded = true;
  for (const l of listeners) l(list);
}

/** Fetch (or re-fetch after a save) and tell every mounted hook. */
export function reloadFacilityPrograms(): Promise<FacilityProgram[]> {
  inflight = api.getFacilityPrograms()
    .then((list) => { publish(list); return list; })
    .catch(() => getFacilityPrograms())
    .finally(() => { inflight = null; });
  return inflight;
}

/** Push a freshly saved list without another round trip. */
export function publishFacilityPrograms(list: FacilityProgram[]) {
  publish(list);
}

export function useFacilityPrograms(): FacilityProgram[] {
  const [list, setList] = useState<FacilityProgram[]>(getFacilityPrograms);
  useEffect(() => {
    listeners.add(setList);
    if (!loaded && !inflight) void reloadFacilityPrograms();
    else setList(getFacilityPrograms());
    return () => { listeners.delete(setList); };
  }, []);
  return list;
}
