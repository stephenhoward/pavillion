import { DateTime } from "luxon";

import { Account } from "@/common/model/account";
import { WebFingerResponse } from "@/common/model/message/webfinger";
import { UserProfileResponse } from "@/common/model/message/userprofile";
import { ActivityPubMessage } from "@/common/model/message/actions";
import { CreateMessage, UpdateMessage, DeleteMessage } from "@/common/model/message/actions";
import { ActivityPubInboxMessageEntity, EventActivityEntity, FollowedAccountEntity, SharedEventEntity } from "@/server/common/entity/activitypub";
import AccountService from "@/server/accounts/service/account";
import EventService from "@/server/members/service/events";


class ActivityPubService {

    constructor() {}

    /**
     * parse the webfinger resource format into username and domain
     * @param resource 
     * @returns { username, domain}
     */
    parseWebFingerResource(resource: string): { username: string, domain: string } {
        resource = resource.replace('acct:', '');
        let parts = resource.split('@');

        if ( parts.length === 2 && parts[0].length > 0 && parts[1].length > 0 ) {
            return { username: parts[0], domain: parts[1] };
        }

        return { username: '', domain: '' };
    }

    /**
     * Generate a webfinger response for the provided username
     * @param username 
     * @param domain 
     * @returns WebFingerResponse message
     */
    // TODO: something useful with the domain info (validation?)
    async lookupWebFinger(username: string, domain: string): Promise<WebFingerResponse|null> {
        let profile = await AccountService.getProfileForUsername(username);

        if ( profile ) {
            return new WebFingerResponse(profile.username, domain);
        }

        return null;
    }

    /**
     * Generate an actor message for the provided username
     * @param username 
     * @param domain 
     * @returns UserProfileResponse message
     */
    async lookupUserProfile(username: string, domain: string): Promise<UserProfileResponse|null> {
        let profile = await AccountService.getProfileForUsername(username);

        if ( profile ) {
            return new UserProfileResponse(profile.username, domain);
        }

        return null;
    }

    /**
     * Add provided message to the account's inbox
     * @param account
     * @param message 
     * @returns null
     */
    // TODO permissions? block lists? rate limiting?
    async addToInbox(account: Account, message: ActivityPubMessage ): Promise<null> {
        let foundAccount = await AccountService.getAccount(account.id);

        if ( foundAccount === null ) {
            throw new Error('Account not found');
        }

        let messageEntity = ActivityPubInboxMessageEntity.build({
            account_id: account.id,
            message: message
        });
        await messageEntity.save();

        return null;
    }

    /**
     * 
     * @param account Retrieve messages from the outbox of the provided account
     * @param limit 
     * @returns a list of ActivityPubMessage objects
     */
    async readOutbox(account: Account, limit?: DateTime): Promise<ActivityPubMessage[]> {
        let messageEntities = await ActivityPubInboxMessageEntity.findAll({
            where: { account_id: account.id },
            order: [['created_at', 'DESC']]
        });

        return messageEntities.map( (message) => message.toModel() );
    }

}

export default ActivityPubService;
