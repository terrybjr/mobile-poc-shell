import { Routes } from '@angular/router';
import { loadRemoteModule } from '@angular-architects/module-federation';

export const routes: Routes = [
  { path: '', redirectTo: 'myhealth', pathMatch: 'full' },
  {
    path: 'myhealth',
    loadComponent: () =>
      loadRemoteModule({
        type: 'module',
        remoteEntry: 'https://brianthedeveloper.com/pension/health/remoteEntry.js?v=mock-editor-20260917',
        exposedModule: './Component'
      }).then((module) => module.HealthComponent)
  }
];
