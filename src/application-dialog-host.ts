import { useSyncExternalStore } from 'react';
import { applicationDialogs, type ApplicationDialogService } from './application-dialogs';

/** Subscribe to the first pending dialog; markup, translations and CSS belong to the host. */
export function useApplicationDialogRequest(service: ApplicationDialogService = applicationDialogs) {
  return useSyncExternalStore(service.subscribe, service.getSnapshot, service.getSnapshot)[0];
}
