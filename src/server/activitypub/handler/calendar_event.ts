import EventProxy from '@/server/common/helper/event_proxy';
import ActivityPubService from '@/server/activitypub/service/members';
import CreateActivity from '@/server/activitypub/model/action/create';
import UpdateActivity from '@/server/activitypub/model/action/update';
import DeleteActivity from '@/server/activitypub/model/action/delete';
import { EventObject } from '@/server/activitypub/model/object/event';

export default class CalendarEventHandler {

  static async init() {
    const events = EventProxy.getInstance();
    const service = new ActivityPubService(events);
    events.listen('eventCreated', async (e) => {
      let actorUrl = await service.actorUrl(e.calendar);
      service.addToOutbox(
        e.calendar,
        new CreateActivity(
          actorUrl,
          new EventObject(e.calendar, e.event),
        ),
      );
    });
    events.listen('eventUpdated', async (e) => {
      let actorUrl = await service.actorUrl(e.calendar);
      service.addToOutbox(
        e.calendar,
        new UpdateActivity(
          actorUrl,
          new EventObject(e.calendar, e.event),
        ),
      );
    });
    events.listen('eventDeleted', async (e) => {
      let actorUrl = await service.actorUrl(e.calendar);
      service.addToOutbox(
        e.calendar,
        new DeleteActivity(
          actorUrl,
          EventObject.eventUrl(e.calendar, e.event),
        ),
      );
    });
  }
}
