import{ expect, describe, it, afterEach } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import sinon from 'sinon';

import { CalendarEvent } from '@/common/model/events';
import { EventLocation } from '@/common/model/location';
import { mountComponent } from '@/client/test/lib/vue';
import { useEventStore } from '@/client/stores/eventStore';
import ModelService from '@/client/service/models';
import EditEvent from '@/client/components/calendar/edit_event.vue';

const routes: RouteRecordRaw[] = [
    { path: '/login',  component: {}, name: 'login', props: true },
    { path: '/logout', component: {}, name: 'logout' },
    { path: '/register', component: {}, name: 'register', props: true },
    { path: '/forgot', component: {}, name: 'forgot_password', props: true },
    { path: '/apply',  component: {}, name: 'register-apply', props: true },
    { path: '/reset',  component: {}, name: 'reset_password', props: true }
];

const mountedEditor = (event: CalendarEvent) => {
    let router: Router = createRouter({
        history: createMemoryHistory(),
        routes: routes
    });

    const wrapper = mountComponent(EditEvent, router, {
        provide: {
            site_config: {
                settings: {}
            },
        },
        props: {
            event: event
        }
    });

    return {
        wrapper,
        router
    }
};

describe('Editor Behavior', () => {
    const sandbox = sinon.createSandbox();

    afterEach(() => {
        sandbox.restore();
    })

    it('new event', async () => {
        let event = new CalendarEvent('', '');
        event.location = new EventLocation('', '');
        const { wrapper, router } = mountedEditor(event);
        const eventStore = useEventStore();

        let createStub = sandbox.stub(ModelService, 'createModel');
        let updateStub = sandbox.stub(ModelService, 'updateModel');
        let addEventStoreStub = sandbox.stub(eventStore, 'addEvent');
        let updateEventStoreStub = sandbox.stub(eventStore, 'updateEvent');

        createStub.resolves(new CalendarEvent('id', 'testDate'));

        wrapper.find('input[name="name"]').setValue('testName');
        wrapper.find('input[name="description"]').setValue('testDescription');
        
        await wrapper.find('button[type="submit"]').trigger('click');

        expect(createStub.called).toBe(true);
        expect(updateStub.called).toBe(false);
        expect(addEventStoreStub.called).toBe(true);
        expect(updateEventStoreStub.called).toBe(false);
    });

    it('existing event', async () => {
        let event = new CalendarEvent('hasId', '');
        event.location = new EventLocation('', '');
        const { wrapper, router } = mountedEditor(event);
        const eventStore = useEventStore();

        let createStub = sandbox.stub(ModelService, 'createModel');
        let updateStub = sandbox.stub(ModelService, 'updateModel');
        let addEventStoreStub = sandbox.stub(eventStore, 'addEvent');
        let updateEventStoreStub = sandbox.stub(eventStore, 'updateEvent');

        updateStub.resolves(new CalendarEvent('hasId', 'testDate'));

        wrapper.find('input[name="name"]').setValue('testName');
        wrapper.find('input[name="description"]').setValue('testDescription');
        
        await wrapper.find('button[type="submit"]').trigger('click');

        expect(createStub.called).toBe(false);
        expect(updateStub.called).toBe(true);
        expect(addEventStoreStub.called).toBe(false);
        expect(updateEventStoreStub.called).toBe(true);
    });

});