import express from 'express';
import { AccountEntity } from '../../entity/account';

let router = express.Router();

router.get('/webfinger', async (req, res) => {

    let resourceString = req.query.resource as string;

    if (!resourceString) {
        res.status(400).json({
            "error": "missing resource parameter"
        });
        return;
    }

    let acctURI = RegExp('acct:([^@]+)@(.*)').exec(resourceString);

    if (!acctURI) {
        res.status(400).json({
            "error": "invalid resource parameter"
        });
        return;
    }

    let username = acctURI[1];
    let host = acctURI[2];


    let user = await AccountEntity.findOne({ where: {username: username}});

    if (!user) {
        res.status(404).json({
            "error": "resource not found"
        });
        return;
    }

    res.json({
        "subject": req.query.resource,
        "links": [
            {
                "rel": "self",
                "type": "application/activity+json",
                "href": `https://${host}/@${username}`
            }
        ]
    });
});

export default router;