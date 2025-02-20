import { DateTime } from "luxon";
import { v4 as uuidv4 } from 'uuid';

import { Account } from "@/common/model/account";
import CreateActivity from "@/server/activitypub/model/action/create";
import UpdateActivity from "@/server/activitypub/model/action/update";
import DeleteActivity from "@/server/activitypub/model/action/delete";
import FollowActivity from "@/server/activitypub/model/action/follow";
import AnnounceActivity from "@/server/activitypub/model/action/announce";
import { ActivityPubInboxMessageEntity, EventActivityEntity, FollowedAccountEntity, SharedEventEntity } from "@/server/activitypub/entity/activitypub";
import AccountService from "@/server/accounts/service/account";
import EventService from "@/server/calendar/service/events";


class ProcessInboxService {
    eventService: EventService;

    constructor() {
        this.eventService = new EventService();
    }

    async processInboxMessages() {

        let messages: ActivityPubInboxMessageEntity[] = [];

        // TODO: messageTime based cursor, perhaps, so we don't keep reprocessing the same messages if they never get processed
        do {
            messages = await ActivityPubInboxMessageEntity.findAll({
                where: { processedAt: null },
                order: [ ['messageTime', 'ASC'] ],
                limit: 1000
            });
    
            for( const message of messages ) {
                await this.processInboxMessage(message);
                await message.update({ processedAt: DateTime.now().toJSDate() });
            }
        } while( messages.length > 0 );
    }

    // TODO: validate message sender was allowed to send this message
    async processInboxMessage(message: ActivityPubInboxMessageEntity ) {
        const account = await AccountService.getAccount(message.account_id);

        if ( ! account ) {
            console.error('No account found for message');
            return;
        }

        switch( message.type ) {
            case 'Create':
                await this.processCreateEvent(account, CreateActivity.fromObject(message.message) );
                break;
            case 'Update':
                this.processUpdateEvent(account, UpdateActivity.fromObject(message.message) );
                break;
            case 'Delete':
                this.processDeleteEvent(account, DeleteActivity.fromObject(message.message) );
                break;
            case 'Follow':
                this.processFollowAccount(account, FollowActivity.fromObject(message.message) );
                break;
            case 'Announce':
                this.processShareEvent(account, AnnounceActivity.fromObject(message.message) );
                break;
            case 'Undo':
                let targetEntity = await ActivityPubInboxMessageEntity.findOne({
                     where: { accountId: message.account_id, id: message.message.object }
                });

                if ( targetEntity ) {

                    switch( targetEntity.type ) {
                        case 'Follow':
                            this.processUnfollowAccount(account, targetEntity);
                            break;
                        case 'Announce':
                            this.processUnshareEvent(account, targetEntity);
                            break;
                        }
                }
        }
    }

    async processCreateEvent(account: Account, message: CreateActivity) {
        //TODO: implement eventService.importEvent
        let event = await this.eventService.createEvent(null, message.object.toObject());
        //TODO add to account's feed table if they follow the event owner
    }

    async processUpdateEvent(account: Account, message: UpdateActivity) {
        //TODO: implement eventService.updateImportedEvent
        let event = await this.eventService.updateEvent(null, message.object.id, message.object.toObject());
    }

    async processDeleteEvent(account: Account, message: DeleteActivity) {
        //TODO: implement eventService.deleteImportedEvent
        let event = await this.eventService.deleteEvent(null, message.object.id);
        SharedEventEntity.destroy({ where: { eventId: message.object.id } });
        //TODO remove from feed table for all users
    }

    async processFollowAccount(account: Account, message: any) {
        FollowedAccountEntity.create({
            id: uuidv4(),
            remote_account_id: message.object.attributedTo,
            account_id: account.id,
            direction: 'follower'
        });
    }

    async processUnfollowAccount(account: Account, message: any) {
        FollowedAccountEntity.destroy({
            where: {
                remote_account_id: message.object.attributedTo,
                account_id: account.id,
                direction: 'follower'
            }
        });
    }

    async processShareEvent(account: Account, message: any) {
        // If it's the account's own event
        EventActivityEntity.create({
            event_id: message.object.attributedTo,
            account_id: account.id,
            type: 'share'
        });
        // TODO: otherwise import the event and put it in the account's feed
    }

    async processUnshareEvent(account: Account, message: any) {
        // If it's the account's own event
        EventActivityEntity.destroy({
            where: {
                eventId: message.object.attributedTo,
                accountId: account.id,
                type: 'share'
            }
        });
        // TODO: otherwise remove it from all follower accounts' feeds
    }
}

export default ProcessInboxService;