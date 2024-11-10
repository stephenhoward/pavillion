import express from 'express';
import passport from 'passport';
//import EventService from '../../../../service/events';
import { VoidExpression } from 'typescript';
var router = express.Router();

router.get('/events', async (req, res) => {
    const { account } = req.query;

    if (!account || typeof account !== "string") {
        res.status(400).json({
            "error": "missing username parameter"
        });
        return;
    }

    //const events = EventService.listEvents(account, 10, 0, req.user);
    //res.json(events);
});

router.post('/events', async (req, res) => {
    //EventService.addEvent(req.body, req.user);
});

router.post('/events/:id', async (req, res) => {
    //EventService.updateEvent(req.params.id, req.body, req.user);
});

export default router;