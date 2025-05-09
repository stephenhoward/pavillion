import { defineStore } from 'pinia';
import AccountApplication from '../../common/model/application';

export const useApplicationStore = defineStore('applications', {
  state: () => ({
    applications: [] as AccountApplication[],
  }),

  actions: {
    /**
     * Adds a new account application to the store.
     *
     * @param {AccountApplication} application - The account application to add
     */
    addApplication(application: AccountApplication) {
      this.applications.push(application);
    },

    /**
     * Removes an account application from the store.
     *
     * @param {AccountApplication} application - The acount application to remove
     */
    removeApplication(application: AccountApplication) {
      const index = this.applications.findIndex(app => app.id === application.id);
      if (index !== -1) {
        this.applications.splice(index, 1);
      }
    },

    /**
     * Sets the list of account applications in the store.
     *
     * @param {AccountApplication[]} applications - Array of account applications to use
     */
    setApplications(applications: AccountApplication[]) {
      this.applications = applications;
    },
  },
});
