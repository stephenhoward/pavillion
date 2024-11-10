import express from 'express';
import serverAuth from '../../../authn';

var router = express.Router();

router.post('/token', serverAuth.login );

export default router;