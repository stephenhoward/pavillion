import { DateTime } from "luxon";
import { EventEmitter } from "events";

import { Account } from "@/common/model/account";
import { WebFingerResponse } from "@/common/model/message/webfinger";
import { UserProfileResponse } from "@/common/model/message/userprofile";
import { CreateMessage, UpdateMessage, DeleteMessage } from "@/common/model/message/actions";
import { ActivityPubInboxMessageEntity, EventActivityEntity, FollowedAccountEntity, SharedEventEntity } from "@/server/activitypub/entity/activitypub";
import AccountService from "@/server/accounts/service/account";
import EventService from "@/server/calendar/service/events";


class ActivityPubService {
    eventService: EventService;

    constructor() {
        this.eventService = new EventService();
    }

    registerListeners(source: EventEmitter) {
        source.on('eventCreated', (event) => { console.log('eventCreated, send to fediverse'); });
        source.on('eventUpdated', (event) => { console.log('eventUpdated, send to fediverse'); });
        source.on('eventDeleted', (event) => { console.log('eventDeleted, send to fediverse'); });
    }

    async followAccount(account: Account, remoteAccount: string) {
        // send follow message to remote account
        FollowedAccountEntity.create({
            remoteAccountId: remoteAccount,
            accountId: account.id,
            direction: 'following'
        });
    }

    async unfollowAccount(account: Account, remoteAccount: string) {
        // send undo follow message to remote account
        FollowedAccountEntity.destroy({
            where: {
                remoteAccountId: remoteAccount,
                accountId: account.id,
                direction: 'following'
            }
        });
    }

    async shareEvent(account: Account, eventId: string) {
        // send announce message to followers
        SharedEventEntity.create({
            eventId: eventId,
            accountId: account.id
        });
    }

    async unshareEvent(account: Account, eventId: string) {
        // send undo announce message to followers
        SharedEventEntity.destroy({
            where: {
                eventId: eventId,
                accountId: account.id
            }
        });
    }
}

export default ActivityPubService;