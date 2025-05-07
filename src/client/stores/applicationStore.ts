import { defineStore } from 'pinia';
import AccountApplication from '../../common/model/application';

export const useApplicationStore = defineStore('applications', {
  state: () => ({
    applications: [] as AccountApplication[],
  }),

  actions: {
    addApplication(application: AccountApplication) {
      this.applications.push(application);
    },

    removeApplication(application: AccountApplication) {
      const index = this.applications.findIndex(app => app.id === application.id);
      if (index !== -1) {
        this.applications.splice(index, 1);
      }
    },

    setApplications(applications: AccountApplication[]) {
      this.applications = applications;
    },
  },
});
