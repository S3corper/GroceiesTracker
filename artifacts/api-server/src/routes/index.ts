import { Router, type IRouter } from "express";
import healthRouter from "./health";
import receiptsRouter from "./receipts";
import localRouter from "./local";

const router: IRouter = Router();

router.use(healthRouter);
router.use(localRouter);
router.use(receiptsRouter);

export default router;
