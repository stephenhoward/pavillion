import { DateTime } from "luxon";
import AccountService from "@/server/accounts/service/account";
import { ActivityPubOutboxMessageEntity } from "@/server/activitypub/entity/activitypub"
import UpdateActivity from "@/server/activitypub/model/action/update";
import DeleteActivity from "@/server/activitypub/model/action/delete";
import FollowActivity from "@/server/activitypub/model/action/follow";
import AnnounceActivity from "@/server/activitypub/model/action/announce";
import CreateActivity from "@/server/activitypub/model/action/create";
import UndoActivity from "@/server/activitypub/model/action/undo";


class ProcessOutboxService {

    constructor() {

    }

    async processOutboxMessages() {

        let messages: ActivityPubOutboxMessageEntity[] = [];

        do {
            messages = await ActivityPubOutboxMessageEntity.findAll({
                where: { processedAt: null },
                order: [ ['messageTime', 'ASC'] ],
                limit: 1000
            });

            for( const message of messages ) {
                await this.processOutboxMessage(message);
                await message.update({ processedAt: DateTime.now().toJSDate() })
            }
        } while( messages.length > 0 );
    }

    async processOutboxMessage(message: ActivityPubOutboxMessageEntity) {
        const account = await AccountService.getAccount(message.account_id);

        if ( ! account ) {
            console.error("No account found for message");
            return;
        }

        let activity = null;

        switch( message.type ) {
            case 'Create':
                activity = CreateActivity.fromObject(message.message);
                break;
            case 'Update':
                activity = UpdateActivity.fromObject(message.message);
                break;
            case 'Delete':
                activity = DeleteActivity.fromObject(message.message);
                break;
            case 'Follow':
                activity = FollowActivity.fromObject(message.message);
                break;
            case 'Announce':
                activity = AnnounceActivity.fromObject(message.message);
                break;
            case 'Undo':
                activity = UndoActivity.fromObject(message.message);
                break;
        }

        if ( activity ) {
            // TODO: send the the appropriate inboxes across the web
            // usually followers, but also anyone who has announced
            // an object we're modifying/deleting
        }
    }
}