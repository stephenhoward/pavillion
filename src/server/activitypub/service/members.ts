import { DateTime } from "luxon";
import { EventEmitter } from "events";

import { Account } from "@/common/model/account";
import { ActivityPubActivity } from "@/server/activitypub/model/base";
import CreateActivity from '@/server/activitypub/model/action/create';
import UpdateActivity from '@/server/activitypub/model/action/update';
import DeleteActivity from '@/server/activitypub/model/action/delete';
import FollowActivity from "@/server/activitypub/model/action/follow";
import AnnounceActivity from "@/server/activitypub/model/action/announce";
import { EventObject } from '@/server/activitypub/model/object/event';
import AccountService from "@/server/accounts/service/account";
import EventService from "@/server/calendar/service/events";
import { ActivityPubOutboxMessageEntity, FollowedAccountEntity, SharedEventEntity } from "@/server/activitypub/entity/activitypub";
import UndoActivity from "../model/action/undo";

class ActivityPubService extends EventEmitter {
    eventService: EventService;

    constructor() {
        super();
        this.eventService = new EventService();
    }

    async actorUrl(account: Account): Promise<string> {
        let profile = await AccountService.getProfileForAccount(account);
        
        return profile
          ? 'https://' + profile.domain + '/users/' + profile.username
          : '';
    }

    registerListeners(source: EventEmitter) {
        source.on('eventCreated', async (e) => {
            let actorUrl = await this.actorUrl(e.account);
            let profile = await AccountService.getProfileForAccount(e.account);
            if ( profile ) {
                this.addToOutbox(
                    e.account,
                    new CreateActivity(
                        actorUrl,
                        new EventObject(profile, e.event)
                    )
                );
            }
            else {
                console.log('no profile found for account that created event');
            }
        });
        source.on('eventUpdated', async (e) => {
            let actorUrl = await this.actorUrl(e.account);
            let profile = await AccountService.getProfileForAccount(e.account);
            if ( profile ) {
                this.addToOutbox(
                    e.account,
                    new UpdateActivity(
                        actorUrl,
                        new EventObject(e.profile, e.event)
                    )
                );
                }
                else {
                    console.log('no profile found for account that updated event');
                }
            });
        source.on('eventDeleted', async (e) => {
            let profile = await AccountService.getProfileForAccount(e.account);
            if ( profile ) {
                let actorUrl = await this.actorUrl(e.account);
                this.addToOutbox(
                    e.account,
                    new DeleteActivity(
                        actorUrl,
                        EventObject.eventUrl(profile, e.event)
                    )
                );
            }
            else {
                console.log('no profile found for account that deleted event');
            }
        });
    }

    static isValidDomain(domain: string): boolean {
        return domain.match(/^((?!-)[A-Za-z0-9-]{1,63}(?<!-)\.)+[A-Za-z]{2,}$/) !== null;
    }
    static isValidUsername(username: string): boolean {
        return username.match(/^[a-z0-9_]{3,16}$/) !== null;
    }

    static isValidUserIdentifier(identifier: string): boolean {
        let parts = identifier.split('@');
        return parts.length === 2
            && ActivityPubService.isValidUsername(parts[0])
            && ActivityPubService.isValidDomain(parts[1]);
    }

    async followAccount(account: Account, accountIdentifier: string) {

        if ( ! ActivityPubService.isValidUserIdentifier(accountIdentifier) ) {
            throw new Error('Invalid remote account identifier: ' + accountIdentifier);
        }

        let existingFollowEntity = await FollowedAccountEntity.findOne({ where: {
            remote_account_id: accountIdentifier,
            account_id: account.id,
            direction: 'following'
        }});
        if ( existingFollowEntity ) {
            return;
        }

        let actor = await this.actorUrl(account);
        // TODO: transform accountIdentifier into a URL (via webfinger?)
        let followActivity = new FollowActivity( actor, accountIdentifier );

        let followEntity = FollowedAccountEntity.build({
            id: followActivity.id,
            remote_account_id: accountIdentifier,
            account_id: account.id,
            direction: 'following'
        });
        await followEntity.save()
    
        this.addToOutbox( account, followActivity );
    }

    async unfollowAccount(account: Account, accountIdentifier: string) {

        let follows = await FollowedAccountEntity.findAll({
            where: {
                remote_account_id: accountIdentifier,
                account_id: account.id,
                direction: 'following'
            }
        });
        let actor = await this.actorUrl(account);
        for ( let follow of follows ) {
            this.addToOutbox(account, new UndoActivity(actor, follow.id ));
            follow.destroy();
        }
     }

    /**
     * user on this server shares an event from someone else
     * @param account 
     * @param eventUrl - url of remote event
     */
    async shareEvent(account: Account, eventUrl: string) {

        if ( ! eventUrl.match("^https:\/\/") ) {
            throw new Error('Invalid shared event url: ' + eventUrl);
        }

        let existingShareEntity = await FollowedAccountEntity.findOne({ where: {
            event_id: eventUrl,
            account_id: account.id,
        }});
        if ( existingShareEntity ) {
            return;
        }

        let actor = await this.actorUrl(account);
        let shareActivity = new AnnounceActivity( actor, eventUrl );

        SharedEventEntity.create({
            id: shareActivity.id,
            eventId: eventUrl,
            accountId: account.id
        });
        this.addToOutbox( account, shareActivity );
    }

    /**
     * user on this server stops sharing an event from someone else
     * @param account - account of user stopping sharing
     * @param eventId - url of remote event
     */
    async unshareEvent(account: Account, eventUrl: string) {
        let shares = await SharedEventEntity.findAll({
            where: {
                eventId: eventUrl,
                accountId: account.id
            }
        });
        let actorUrl = await this.actorUrl(account);
        for ( let share of shares ) {
            this.addToOutbox(account, new UndoActivity(actorUrl, share.id ));
            share.destroy();
        }
    }

    async addToOutbox(account: Account, message: ActivityPubActivity) {
        let accountUrl = await this.actorUrl(account);

        if ( accountUrl == message.actor ) {
            let messageEntity = ActivityPubOutboxMessageEntity.build({
                id: message.id,
                type: message.type,
                account_id: account.id,
                message_time: DateTime.utc(),
                message: message
            })
            await messageEntity.save();

            this.emit('outboxMessageAdded', message);
        }
    }
}

export default ActivityPubService;