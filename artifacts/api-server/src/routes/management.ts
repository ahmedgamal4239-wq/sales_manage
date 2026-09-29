import { Router, type IRouter } from "express";
import { Readable } from "node:stream";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, users, sessions, customers, customerPayments, products, branches, sales, attendance, audit } from "@workspace/db";
import { CreateUserBody, UpdateUserBody, CreateCustomerBody, UpdateCustomerBody, CreateProductBody, UpdateProductBody, CreateBranchBody, UpdateBranchBody, RequestCustomerPaymentPhotoUploadBody, RequestCustomerPaymentPhotoUploadResponse, ListCustomerPaymentsResponse, CreateCustomerPaymentBody, CreateCustomerPaymentResponse, GetCustomerPaymentPhotoParams } from "@workspace/api-zod";
import { requireEmployee, requirePermission, publicUser, hashPassword, scopedBranches, scopedCustomers, scopedSales, scopedAttendance, hasPermission, effectivePermissions, permissionsForRole, permissionsWithinRoleCeiling, permissionSetHasMatchingViews, isManager } from "../lib/ops-auth";
import { createPaymentPhotoUpload, fetchPaymentPhoto, inspectPaymentPhoto, PAYMENT_PHOTO_CONTENT_TYPES } from "../lib/private-payment-photos";

const router: IRouter = Router();
const idOf = (value: string | string[] | undefined) => {
  const raw = Array.isArray(value) ? value[0] : value;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};
const permissionValues = ["dashboard.view","users.view","users.manage","customers.view","customers.manage","branches.view","branches.manage","products.view","products.manage","imports.manage","exports.view","sales.view","sales.write","attendance.view","attendance.write"];
function duplicate(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "23505";
}
async function customerInScope(id: number, actor: Awaited<ReturnType<typeof requireEmployee>>) {
  if (!actor) return undefined;
  const condition = isManager(actor)
    ? eq(customers.id,id)
    : and(eq(customers.id,id),eq(customers.ownerId,actor.id));
  const [customer] = await db.select().from(customers).where(condition);
  return customer;
}
function validPaymentDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0,10) === value;
}
function validPaymentAmount(value: string): boolean {
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(value)) return false;
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2,"0")) > 0;
}
function paymentResponse(payment: typeof customerPayments.$inferSelect) {
  return {
    id:payment.id,
    customerId:payment.customerId,
    recordedBy:payment.recordedBy,
    method:payment.method,
    amount:String(payment.amount),
    paymentDate:payment.paymentDate,
    createdAt:payment.createdAt.toISOString(),
    photoAvailable:!!payment.photoObjectPath,
  };
}
async function validAssignment(role: string, areaId: number | null | undefined, branchId: number | null | undefined, userId?: number) {
  if (role === "AREA_MANAGER") {
    return Number.isSafeInteger(areaId) && !!areaId && areaId > 0 && branchId == null;
  }
  if (role === "HYPER_SELLER" || role === "HYPER_AGENT") {
    if (!Number.isSafeInteger(branchId) || !branchId || areaId != null) return false;
    const [branch] = await db.select({id:branches.id,agentId:branches.agentId}).from(branches).where(eq(branches.id,branchId));
    return !!branch && (role !== "HYPER_AGENT" || branch.agentId === null || branch.agentId === userId);
  }
  return areaId == null && branchId == null;
}
async function validBranchAgent(agentId: number | null | undefined) {
  if (agentId == null) return true;
  const [agent] = await db.select({id:users.id}).from(users)
    .where(and(eq(users.id,agentId),eq(users.role,"HYPER_AGENT"),eq(users.active,true)));
  return !!agent;
}
router.get("/users", async (req,res): Promise<void> => {
  const actor = await requireEmployee(req,res);
  if (!actor || !requirePermission(actor,"users.view",res)) return;
  res.json((await db.select().from(users).orderBy(users.id)).map(publicUser));
});
router.post("/users", async (req,res): Promise<void> => {
  const actor = await requireEmployee(req,res);
  if (!actor || !requirePermission(actor,"users.manage",res)) return;
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {res.status(400).json({error:"Valid employee details, role, and temporary password required"}); return;}
  const value = parsed.data;
  const employeeId=value.employeeId.trim(), nameAr=value.nameAr.trim();
  if (!employeeId || !nameAr) {res.status(400).json({error:"Employee ID and name are required"});return;}
  if (!permissionsWithinRoleCeiling(value.role,value.permissions)) {res.status(400).json({error:"One or more permissions are not allowed for the selected role"});return;}
  if (!permissionSetHasMatchingViews(value.role,value.permissions)) {res.status(400).json({error:"Manage/write permissions require their matching view permission"});return;}
  const actorPermissions=new Set(effectivePermissions(actor));
  const requestedPermissions=permissionsForRole(value.role,value.permissions);
  if (requestedPermissions.some(permission=>!actorPermissions.has(permission))) {
    res.status(403).json({error:"You cannot grant permissions you do not hold"});return;
  }
  if (value.role !== "PENDING" && !(await validAssignment(value.role,value.areaId??null,value.branchId??null))) {res.status(400).json({error:"Role requires a valid matching assignment"});return;}
  if (value.role === "PENDING" && (value.areaId != null || value.branchId != null)) {res.status(400).json({error:"Pending employees cannot have role assignments"});return;}
  try {
    const result = await db.transaction(async tx => {
      const [currentActor]=await tx.select().from(users).where(eq(users.id,actor.id)).for("update");
      if (!currentActor || !currentActor.active || currentActor.sessionVersion !== actor.sessionVersion) return {status:"stale" as const};
      const currentPermissions=new Set(effectivePermissions(currentActor));
      if (requestedPermissions.some(permission=>!currentPermissions.has(permission))) return {status:"forbidden" as const};
      const [newUser] = await tx.insert(users).values({
        employeeId, nameAr, nameEn:value.nameEn?.trim() || null,
        role:value.role, passwordHash:await hashPassword(value.password), active:value.role !== "PENDING", mustChangePassword:true,
        areaId:value.role === "AREA_MANAGER" ? value.areaId! : null,
        branchId:value.role === "HYPER_SELLER" ? value.branchId! : null,
        permissions:value.permissions ?? null,
      }).returning();
      if (value.role === "HYPER_AGENT" && value.branchId) await tx.update(branches).set({agentId:newUser.id}).where(eq(branches.id,value.branchId));
      await tx.insert(audit).values({actorId:actor.id,action:"USER_CREATED",target:String(newUser.id)});
      return {status:"ok" as const,user:newUser};
    });
    if (result.status==="stale") {res.status(409).json({error:"Your access changed; sign in and retry"});return;}
    if (result.status==="forbidden") {res.status(403).json({error:"You cannot grant permissions you do not hold"});return;}
    const created=result.user;
    res.status(201).json(publicUser(created));
  } catch (error) {
    if (duplicate(error)) {res.status(409).json({error:"Employee ID already exists"});return;}
    throw error;
  }
});
router.patch("/users/:id", async (req,res): Promise<void> => {
  const actor = await requireEmployee(req,res);
  if (!actor || !requirePermission(actor,"users.manage",res)) return;
  const id = idOf(req.params.id);
  const parsed = UpdateUserBody.safeParse(req.body);
  if (!id || !parsed.success) {res.status(400).json({error:"Invalid employee update"});return;}
  const value = parsed.data;
  const [existing] = await db.select().from(users).where(eq(users.id,id));
  if (!existing) {res.status(404).json({error:"Employee not found"});return;}
  const actorPermissions=new Set(effectivePermissions(actor));
  const existingPermissions=effectivePermissions(existing);
  if (existingPermissions.some(permission=>!actorPermissions.has(permission))) {
    res.status(403).json({error:"You cannot modify an employee with permissions beyond your own"});return;
  }
  const employeeId=value.employeeId?.trim();
  if (employeeId !== undefined && !employeeId) {res.status(400).json({error:"Employee ID is required"});return;}
  const role=value.role ?? existing.role;
  const resultingPermissions=value.permissions !== undefined
    ? permissionsForRole(role,value.permissions)
    : existingPermissions;
  if (!permissionsWithinRoleCeiling(role,value.permissions !== undefined ? value.permissions : resultingPermissions)) {
    res.status(400).json({error:"One or more permissions are not allowed for the selected role"});return;
  }
  if (!permissionSetHasMatchingViews(role,resultingPermissions)) {
    res.status(400).json({error:"Manage/write permissions require their matching view permission"});return;
  }
  if (resultingPermissions.some(permission=>!actorPermissions.has(permission))) {
    res.status(403).json({error:"You cannot grant permissions you do not hold"});return;
  }
  const permissionsToPersist=value.permissions !== undefined
    ? value.permissions
    : role !== existing.role ? resultingPermissions : undefined;
  const areaId=value.areaId !== undefined ? value.areaId : role === existing.role ? existing.areaId : null;
  const [currentAgentBranch] = existing.role === "HYPER_AGENT"
    ? await db.select({id:branches.id}).from(branches).where(eq(branches.agentId,id)).limit(1)
    : [];
  const branchId=value.branchId !== undefined ? value.branchId :
    role === "HYPER_AGENT" ? (existing.role === "HYPER_AGENT" ? currentAgentBranch?.id ?? null : null) :
    role === existing.role ? existing.branchId : null;
  const active=value.active ?? existing.active;
  if (role === "PENDING" && active) {res.status(400).json({error:"Pending employees cannot be active"});return;}
  if (active && role !== "PENDING" && !await validAssignment(role,areaId,branchId,id)) {res.status(400).json({error:"Role requires a valid matching assignment"});return;}
  if (role !== "PENDING" && !active && (areaId != null || branchId != null) && !await validAssignment(role,areaId,branchId,id)) {res.status(400).json({error:"Role requires a valid matching assignment"});return;}
  if (!existing.active && active && (!value.password || role === "PENDING" || !await validAssignment(role,areaId,branchId,id))) {res.status(400).json({error:"Activating an employee requires a temporary password and role assignment"});return;}
  if (id === actor.id) {
    const removingManage = value.permissions !== undefined && value.permissions !== null && !value.permissions.includes("users.manage");
    if (active === false || role !== existing.role || (removingManage && hasPermission(existing,"users.manage"))) {res.status(400).json({error:"Cannot deactivate, demote, or remove your own user-management permission"});return;}
  }
  try {
  const outcome = await db.transaction(async tx => {
    // Lock all manager rows so concurrent edits cannot remove the final fully privileged manager.
    const managerRows = await tx.select().from(users).where(eq(users.role,"HIGHER_MANAGEMENT")).for("update");
    const lockedActor=managerRows.find(row=>row.id===actor.id);
    if (!lockedActor || lockedActor.sessionVersion!==actor.sessionVersion) return {conflict:true as const};
    const currentActorPermissions=new Set(effectivePermissions(lockedActor));
    if (resultingPermissions.some(permission=>!currentActorPermissions.has(permission))) return {forbidden:true as const};
    const lockedTarget = managerRows.find(row => row.id === id) ??
      (await tx.select().from(users).where(eq(users.id,id)).for("update"))[0];
    if (!lockedTarget || lockedTarget.sessionVersion !== existing.sessionVersion) return {conflict:true as const};
    const remainsFullyPrivileged = (candidate: UserLike) => candidate.active && candidate.role === "HIGHER_MANAGEMENT" &&
      (candidate.permissions === null || permissionValues.every(p => candidate.permissions?.includes(p)));
    type UserLike = typeof existing;
    const next = {...lockedTarget, role, active, permissions:permissionsToPersist !== undefined ? permissionsToPersist : lockedTarget.permissions};
    const privilegedCount = managerRows.filter(row => row.id === id ? remainsFullyPrivileged(next) : remainsFullyPrivileged(row)).length;
    if (remainsFullyPrivileged(lockedTarget) && !remainsFullyPrivileged(next) && privilegedCount === 0) return null;
    const [updated] = await tx.update(users).set({
    ...(employeeId !== undefined ? {employeeId} : {}),
    ...(value.nameAr !== undefined ? {nameAr:value.nameAr} : {}),
    ...(value.nameEn !== undefined ? {nameEn:value.nameEn?.trim() || null} : {}),
    role,
    active,
    areaId:role === "AREA_MANAGER" ? areaId : null,
    branchId:role === "HYPER_SELLER" ? branchId : null,
    ...(permissionsToPersist !== undefined ? {permissions:permissionsToPersist} : {}),
    ...(value.password ? {passwordHash:await hashPassword(value.password), mustChangePassword:true} : {}),
    sessionVersion:existing.sessionVersion+1,
    }).where(eq(users.id,id)).returning();
    await tx.delete(sessions).where(eq(sessions.userId,id));
    const previousAssignmentBranch = existing.role === "HYPER_AGENT" ? currentAgentBranch?.id : existing.branchId;
    if (existing.role === "HYPER_AGENT" && previousAssignmentBranch && (role !== "HYPER_AGENT" || branchId !== previousAssignmentBranch)) {
      await tx.update(branches).set({agentId:null}).where(and(eq(branches.id,previousAssignmentBranch),eq(branches.agentId,id)));
    }
    if (role === "HYPER_AGENT" && branchId && (existing.role !== "HYPER_AGENT" || branchId !== previousAssignmentBranch)) {
      await tx.update(branches).set({agentId:id}).where(eq(branches.id,branchId));
    }
    await tx.insert(audit).values({actorId:actor.id,action:"USER_UPDATED",target:String(id)});
    return updated;
  });
  if (outcome && "forbidden" in outcome) {res.status(403).json({error:"You cannot grant permissions you do not hold"});return;}
  if (outcome && "conflict" in outcome) {res.status(409).json({error:"Employee changed concurrently; reload and retry"});return;}
  if (!outcome) {res.status(409).json({error:"Cannot remove the last active fully privileged manager"});return;}
  const updated=outcome;
  res.json(publicUser(updated));
  } catch (error) {
    if (duplicate(error)) {res.status(409).json({error:"Employee ID already exists"});return;}
    throw error;
  }
});
router.get("/customers", async (req,res): Promise<void> => {
  const actor=await requireEmployee(req,res); if (!actor || !requirePermission(actor,"customers.view",res)) return;
  res.json(await scopedCustomers(actor));
});
router.post("/customers", async (req,res): Promise<void> => {
  const actor=await requireEmployee(req,res); if (!actor || !requirePermission(actor,"customers.manage",res)) return;
  const parsed=CreateCustomerBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.name.trim()) {res.status(400).json({error:"Invalid customer"});return;}
  const v=parsed.data;
  if (isManager(actor) && v.ownerId) {
    const [owner]=await db.select().from(users).where(eq(users.id,v.ownerId));
    if (!owner || !owner.active || !hasPermission(owner,"customers.view")) {res.status(400).json({error:"Choose an active employee who can view customers"});return;}
  }
  const [created]=await db.insert(customers).values({
    ...v,
    name:v.name.trim(),
    ownerId:isManager(actor)?v.ownerId??null:actor.id,
    areaId:isManager(actor)?v.areaId??null:actor.areaId,
  }).returning();
  await db.insert(audit).values({actorId:actor.id,action:"CUSTOMER_CREATED",target:String(created.id)});
  res.status(201).json(created);
});
router.patch("/customers/:id", async (req,res): Promise<void> => {
  const actor=await requireEmployee(req,res); if (!actor || !requirePermission(actor,"customers.manage",res)) return;
  const id=idOf(req.params.id), parsed=UpdateCustomerBody.safeParse(req.body);
  if (!id || !parsed.success || !parsed.data.name.trim()) {res.status(400).json({error:"Invalid customer"});return;}
  const existing=await customerInScope(id,actor);
  if (!existing) {res.status(404).json({error:"Customer not found"});return;}
  if (isManager(actor) && parsed.data.ownerId) {
    const [owner]=await db.select().from(users).where(eq(users.id,parsed.data.ownerId));
    if (!owner || !owner.active || !hasPermission(owner,"customers.view")) {res.status(400).json({error:"Choose an active employee who can view customers"});return;}
  }
  const [updated]=await db.update(customers).set({
    ...parsed.data,
    name:parsed.data.name.trim(),
    ownerId:isManager(actor)?parsed.data.ownerId??null:actor.id,
    areaId:isManager(actor)?parsed.data.areaId??null:actor.areaId,
  }).where(eq(customers.id,id)).returning();
  if (!updated) {res.status(404).json({error:"Customer not found"});return;}
  await db.insert(audit).values({actorId:actor.id,action:"CUSTOMER_UPDATED",target:String(id)});
  res.json(updated);
});
router.post("/customers/:id/payment-photo-upload", async (req,res): Promise<void> => {
  const actor=await requireEmployee(req,res);
  if (!actor || !requirePermission(actor,"customers.manage",res)) return;
  const id=idOf(req.params.id);
  const parsed=RequestCustomerPaymentPhotoUploadBody.safeParse(req.body);
  if (!id || !parsed.success || !PAYMENT_PHOTO_CONTENT_TYPES.has(parsed.data.contentType)) {
    res.status(400).json({error:"Invalid payment photo"});
    return;
  }
  if (!await customerInScope(id,actor)) {res.status(404).json({error:"Customer not found"});return;}
  const upload=await createPaymentPhotoUpload(id,actor.id);
  res.json(RequestCustomerPaymentPhotoUploadResponse.parse(upload));
});
router.get("/customers/:id/payments", async (req,res): Promise<void> => {
  const actor=await requireEmployee(req,res);
  if (!actor || !requirePermission(actor,"customers.view",res)) return;
  const id=idOf(req.params.id);
  if (!id || !await customerInScope(id,actor)) {res.status(404).json({error:"Customer not found"});return;}
  const rows=await db.select().from(customerPayments)
    .where(eq(customerPayments.customerId,id))
    .orderBy(desc(customerPayments.paymentDate),desc(customerPayments.id));
  res.json(ListCustomerPaymentsResponse.parse(rows.map(paymentResponse)));
});
router.post("/customers/:id/payments", async (req,res): Promise<void> => {
  const actor=await requireEmployee(req,res);
  if (!actor || !requirePermission(actor,"customers.manage",res)) return;
  const id=idOf(req.params.id);
  const parsed=CreateCustomerPaymentBody.safeParse(req.body);
  if (!id || !parsed.success || !validPaymentAmount(parsed.data.amount) || !validPaymentDate(parsed.data.paymentDate)) {
    res.status(400).json({error:"Enter a valid positive amount and payment date"});
    return;
  }
  if (!await customerInScope(id,actor)) {res.status(404).json({error:"Customer not found"});return;}
  const photoObjectPath=parsed.data.photoObjectPath||null;
  if (photoObjectPath) {
    const expectedPrefix=`/objects/payment-photos/customers/${id}/employees/${actor.id}/`;
    const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    if (!photoObjectPath.startsWith(expectedPrefix) || !uuid.test(photoObjectPath.slice(expectedPrefix.length))) {
      res.status(400).json({error:"The uploaded photo does not belong to this customer session"});
      return;
    }
    const photo=await inspectPaymentPhoto(photoObjectPath);
    if (!photo) {res.status(400).json({error:"The payment photo is missing, too large, or not a supported image"});return;}
    const [duplicatePhoto]=await db.select({id:customerPayments.id}).from(customerPayments)
      .where(eq(customerPayments.photoObjectPath,photoObjectPath));
    if (duplicatePhoto) {res.status(409).json({error:"This photo has already been used"});return;}
  }
  const [created]=await db.insert(customerPayments).values({
    customerId:id,
    recordedBy:actor.id,
    method:parsed.data.method,
    amount:parsed.data.amount,
    paymentDate:parsed.data.paymentDate,
    photoObjectPath,
  }).returning();
  await db.insert(audit).values({actorId:actor.id,action:"CUSTOMER_PAYMENT_RECORDED",target:String(created.id)});
  res.status(201).json(CreateCustomerPaymentResponse.parse(paymentResponse(created)));
});
router.get("/customers/:id/payments/:paymentId/photo", async (req,res): Promise<void> => {
  const actor=await requireEmployee(req,res);
  if (!actor || !requirePermission(actor,"customers.view",res)) return;
  const parsed=GetCustomerPaymentPhotoParams.safeParse(req.params);
  if (!parsed.success || !await customerInScope(parsed.data.id,actor)) {
    res.status(404).json({error:"Payment photo not found"});
    return;
  }
  const [payment]=await db.select().from(customerPayments).where(and(
    eq(customerPayments.id,parsed.data.paymentId),
    eq(customerPayments.customerId,parsed.data.id),
  ));
  if (!payment?.photoObjectPath) {res.status(404).json({error:"Payment photo not found"});return;}
  const response=await fetchPaymentPhoto(payment.photoObjectPath);
  if (response.status===404) {res.status(404).json({error:"Payment photo not found"});return;}
  if (!response.ok || !response.body) {res.status(502).json({error:"Could not load payment photo"});return;}
  const contentType=response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase()??"";
  if (!PAYMENT_PHOTO_CONTENT_TYPES.has(contentType)) {res.status(502).json({error:"Invalid payment photo content type"});return;}
  res.setHeader("Content-Type",contentType);
  res.setHeader("Cache-Control","private, no-store");
  res.setHeader("X-Content-Type-Options","nosniff");
  res.setHeader("Content-Disposition","inline");
  const length=response.headers.get("content-length");
  if (length) res.setHeader("Content-Length",length);
  Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
});
router.get("/branches", async (req,res): Promise<void> => {
  const actor=await requireEmployee(req,res); if (!actor || !requirePermission(actor,"branches.view",res)) return;
  res.json(await scopedBranches(actor));
});
function validBranch(v:{latitude?:number|null;longitude?:number|null;radiusMeters:number;timezone:string}) {
  try {new Intl.DateTimeFormat("en-US",{timeZone:v.timezone});} catch {return false;}
  return v.radiusMeters >= 20 && v.radiusMeters <= 5000 && (v.latitude == null || v.latitude >= -90 && v.latitude <= 90) && (v.longitude == null || v.longitude >= -180 && v.longitude <= 180);
}
router.post("/branches", async (req,res): Promise<void> => {
  const actor=await requireEmployee(req,res); if (!actor || !requirePermission(actor,"branches.manage",res)) return;
  const parsed=CreateBranchBody.safeParse(req.body);
  if (!parsed.success || !validBranch(parsed.data)) {res.status(400).json({error:"Invalid branch or geofence configuration"});return;}
  if (!await validBranchAgent(parsed.data.agentId)) {res.status(400).json({error:"Assigned employee must be an active hyper agent"});return;}
  const created=await db.transaction(async tx=>{
    let agent: typeof users.$inferSelect | undefined;
    if (parsed.data.agentId != null) {
      [agent]=await tx.select().from(users).where(eq(users.id,parsed.data.agentId)).for("update");
      if (!agent || agent.role!=="HYPER_AGENT" || !agent.active) return null;
    }
    const [branch]=await tx.insert(branches).values({...parsed.data,areaId:parsed.data.areaId??null,agentId:parsed.data.agentId??null}).returning();
    if (agent) {
      await tx.update(users).set({sessionVersion:agent.sessionVersion+1}).where(eq(users.id,agent.id));
      await tx.delete(sessions).where(eq(sessions.userId,agent.id));
      await tx.insert(audit).values({actorId:actor.id,action:"BRANCH_AGENT_ASSIGNED",target:`${branch.id}:${agent.id}`});
    }
    await tx.insert(audit).values({actorId:actor.id,action:"BRANCH_CREATED",target:String(branch.id)});
    return branch;
  });
  if (!created) {res.status(400).json({error:"Assigned employee must be an active hyper agent"});return;}
  res.status(201).json(created);
});
router.patch("/branches/:id", async (req,res): Promise<void> => {
  const actor=await requireEmployee(req,res); if (!actor || !requirePermission(actor,"branches.manage",res)) return;
  const id=idOf(req.params.id),parsed=UpdateBranchBody.safeParse(req.body);
  if (!id || !parsed.success || !validBranch(parsed.data)) {res.status(400).json({error:"Invalid branch or geofence configuration"});return;}
  if (parsed.data.agentId !== undefined && !await validBranchAgent(parsed.data.agentId)) {res.status(400).json({error:"Assigned employee must be an active hyper agent"});return;}
  const [snapshot]=await db.select({agentId:branches.agentId}).from(branches).where(eq(branches.id,id));
  if (!snapshot) {res.status(404).json({error:"Branch not found"});return;}
  const nextAgentId=parsed.data.agentId !== undefined ? parsed.data.agentId : snapshot.agentId;
  const affectedAgentIds=[...new Set([snapshot.agentId,nextAgentId].filter((agentId):agentId is number=>agentId!==null))].sort((a,b)=>a-b);
  const result=await db.transaction(async tx=>{
    const agents=affectedAgentIds.length
      ? await tx.select().from(users).where(inArray(users.id,affectedAgentIds)).orderBy(users.id).for("update")
      : [];
    const [current]=await tx.select().from(branches).where(eq(branches.id,id)).for("update");
    if (!current) return {status:"missing" as const};
    if (current.agentId !== snapshot.agentId) return {status:"conflict" as const};
    if (nextAgentId !== null && !agents.some(agent=>agent.id===nextAgentId && agent.role==="HYPER_AGENT" && agent.active)) {
      return {status:"invalid-agent" as const};
    }
    const [updated]=await tx.update(branches).set(parsed.data).where(eq(branches.id,id)).returning();
    if (current.agentId !== nextAgentId) {
      for (const agent of agents) {
        await tx.update(users).set({sessionVersion:agent.sessionVersion+1}).where(eq(users.id,agent.id));
        await tx.delete(sessions).where(eq(sessions.userId,agent.id));
      }
      await tx.insert(audit).values({
        actorId:actor.id,
        action:"BRANCH_AGENT_REASSIGNED",
        target:`${id}:${current.agentId ?? "none"}->${nextAgentId ?? "none"}`,
      });
    }
    await tx.insert(audit).values({actorId:actor.id,action:"BRANCH_UPDATED",target:String(id)});
    return {status:"ok" as const,updated};
  });
  if (result.status==="missing") {res.status(404).json({error:"Branch not found"});return;}
  if (result.status==="conflict") {res.status(409).json({error:"Branch assignment changed concurrently; reload and retry"});return;}
  if (result.status==="invalid-agent") {res.status(400).json({error:"Assigned employee must be an active hyper agent"});return;}
  res.json(result.updated);
});
router.get("/products", async (req,res): Promise<void> => {
  const actor=await requireEmployee(req,res); if (!actor || !requirePermission(actor,"products.view",res)) return;
  res.json(await db.select().from(products).orderBy(products.code));
});
function validPrice(price:string) {return /^\d{1,12}(\.\d{1,2})?$/.test(price) && Number.isFinite(Number(price));}
router.post("/products", async (req,res): Promise<void> => {
  const actor=await requireEmployee(req,res); if (!actor || !requirePermission(actor,"products.manage",res)) return;
  const parsed=CreateProductBody.safeParse(req.body);
  if (!parsed.success || !validPrice(parsed.data.price)) {res.status(400).json({error:"Invalid product or price"});return;}
  const v=parsed.data;
  const [existing]=await db.select({id:products.id}).from(products).where(eq(products.code,v.code.trim()));
  if (existing) {res.status(409).json({error:"Product code already exists"});return;}
  const [created]=await db.insert(products).values({...v,code:v.code.trim(),nameAr:v.nameAr.trim(),nameEn:v.nameEn||null,priceReview:Number(v.price)===0}).returning();
  await db.insert(audit).values({actorId:actor.id,action:"PRODUCT_CREATED",target:String(created.id)});
  res.status(201).json(created);
});
router.patch("/products/:id", async (req,res): Promise<void> => {
  const actor=await requireEmployee(req,res); if (!actor || !requirePermission(actor,"products.manage",res)) return;
  const id=idOf(req.params.id),parsed=UpdateProductBody.safeParse(req.body);
  if (!id || !parsed.success || !validPrice(parsed.data.price)) {res.status(400).json({error:"Invalid product or price"});return;}
  const v=parsed.data;
  const [updated]=await db.update(products).set({...v,code:v.code.trim(),nameEn:v.nameEn||null,priceReview:Number(v.price)===0}).where(eq(products.id,id)).returning();
  if (!updated) {res.status(404).json({error:"Product not found"});return;}
  await db.insert(audit).values({actorId:actor.id,action:"PRODUCT_UPDATED",target:String(id)});
  res.json(updated);
});
router.get("/dashboard", async (req,res): Promise<void> => {
  const actor=await requireEmployee(req,res); if (!actor) return;
  if (!requirePermission(actor,"dashboard.view",res)) return;
  const [myCustomers,myBranches,mySales,myAttendance,allProducts,allUsers]=await Promise.all([
    hasPermission(actor,"customers.view") ? scopedCustomers(actor) : Promise.resolve([]),
    hasPermission(actor,"branches.view") ? scopedBranches(actor) : Promise.resolve([]),
    hasPermission(actor,"sales.view") ? scopedSales(actor) : Promise.resolve([]),
    hasPermission(actor,"attendance.view") ? scopedAttendance(actor) : Promise.resolve([]),
    hasPermission(actor,"products.view") ? db.select({id:products.id}).from(products) : Promise.resolve([]),
    hasPermission(actor,"users.view") ? db.select({id:users.id}).from(users) : Promise.resolve([]),
  ]);
  res.json({
    users:allUsers.length,
    customers:myCustomers.length, products:allProducts.length, branches:myBranches.length,
    submittedSales:mySales.filter(s=>s.status==="SUBMITTED").length,
    attendanceExceptions:myAttendance.filter(a=>a.status!=="VALID").length,
    salesTotal:(mySales.filter(s=>s.status==="SUBMITTED").reduce((n,s)=>n+Number(s.net),0)).toFixed(2),
  });
});
export default router;