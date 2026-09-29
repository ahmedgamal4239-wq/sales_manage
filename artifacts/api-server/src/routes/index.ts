import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import managementRouter from "./management";
import importsRouter from "./imports";
import sellerRouter from "./seller";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(managementRouter);
router.use(importsRouter);
router.use(sellerRouter);

export default router;
