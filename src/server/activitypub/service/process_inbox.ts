import { DateTime } from "luxon";

import { Account } from "@/common/model/account";
import { WebFingerResponse } from "@/common/model/message/webfinger";
import { UserProfileResponse } from "@/common/model/message/userprofile";
import { CreateMessage, UpdateMessage, DeleteMessage, UndoMessage, AnnounceMessage, FollowMessage } from "@/common/model/message/actions";
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
                await this.processCreateEvent(account, CreateMessage.fromObject(message.message) );
                break;
            case 'Update':
                this.processUpdateEvent(account, UpdateMessage.fromObject(message.message) );
                break;
            case 'Delete':
                this.processDeleteEvent(account, DeleteMessage.fromObject(message.message) );
                break;
            case 'Follow':
                this.processFollowAccount(account, FollowMessage.fromObject(message.message) );
                break;
            case 'Announce':
                this.processShareEvent(account, AnnounceMessage.fromObject(message.message) );
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

    async processCreateEvent(account: Account, message: CreateMessage) {
        let event = await this.eventService.createEvent(null, message.object.toObject());
    }

    async processUpdateEvent(account: Account, message: UpdateMessage) {
        let event = await this.eventService.updateEvent(null, message.object.id, message.object.toObject());
    }

    async processDeleteEvent(account: Account, message: DeleteMessage) {
        let event = await this.eventService.deleteEvent(null, message.object.id);
        SharedEventEntity.destroy({ where: { eventId: message.object.id } });
    }

    async processFollowAccount(account: Account, message: any) {
        FollowedAccountEntity.create({
            remoteAccountId: message.object.attributedTo,
            accountId: account.id,
            direction: 'follower'
        });
    }

    async processUnfollowAccount(account: Account, message: any) {
        FollowedAccountEntity.destroy({
            where: {
                remoteAccountId: message.object.attributedTo,
                accountId: account.id,
                direction: 'follower'
            }
        });
    }

    async processShareEvent(account: Account, message: any) {
        EventActivityEntity.create({
            eventId: message.object.attributedTo,
            accountId: account.id,
            type: 'share'
        });
    }

    async processUnshareEvent(account: Account, message: any) {
        EventActivityEntity.destroy({
            where: {
                eventId: message.object.attributedTo,
                accountId: account.id,
                type: 'share'
            }
        });
    }
}

export default ProcessInboxService;