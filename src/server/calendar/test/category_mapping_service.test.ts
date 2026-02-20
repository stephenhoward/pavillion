import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import CategoryMappingService from '../service/category_mapping';
import { CalendarCategoryMappingEntity } from '../entity/category_mapping';
import db from '@/server/common/entity/db';

describe('CategoryMappingService', () => {
  let sandbox: sinon.SinonSandbox;
  let service: CategoryMappingService;

  const calendarId = 'calendar-uuid-1';
  const sourceActorId = 'actor-uuid-1';

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    service = new CategoryMappingService();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('getMappings', () => {
    it('should return all mappings for a calendar and actor', async () => {
      const mockEntities = [
        { id: 'map-1', following_calendar_id: calendarId, source_calendar_actor_id: sourceActorId, source_category_id: 'src-cat-1', source_category_name: 'Music', local_category_id: 'local-cat-1' },
        { id: 'map-2', following_calendar_id: calendarId, source_calendar_actor_id: sourceActorId, source_category_id: 'src-cat-2', source_category_name: 'Art', local_category_id: 'local-cat-2' },
      ];

      sandbox.stub(CalendarCategoryMappingEntity, 'findAll').resolves(mockEntities as any);

      const result = await service.getMappings(calendarId, sourceActorId);

      expect(result).toEqual(mockEntities);
      expect(result).toHaveLength(2);
    });

    it('should return empty array when no mappings exist', async () => {
      sandbox.stub(CalendarCategoryMappingEntity, 'findAll').resolves([]);

      const result = await service.getMappings(calendarId, sourceActorId);

      expect(result).toEqual([]);
    });

    it('should query with correct where clause', async () => {
      const findAllStub = sandbox.stub(CalendarCategoryMappingEntity, 'findAll').resolves([]);

      await service.getMappings(calendarId, sourceActorId);

      expect(findAllStub.calledOnce).toBeTruthy();
      const callArgs = findAllStub.firstCall.args[0];
      expect(callArgs.where).toMatchObject({
        following_calendar_id: calendarId,
        source_calendar_actor_id: sourceActorId,
      });
    });
  });

  describe('setMappings', () => {
    let mockTransaction: { commit: sinon.SinonStub; rollback: sinon.SinonStub };

    beforeEach(() => {
      mockTransaction = {
        commit: sandbox.stub().resolves(),
        rollback: sandbox.stub().resolves(),
      };
      sandbox.stub(db, 'transaction').resolves(mockTransaction as any);
    });

    it('should throw when mappings array has more than 100 entries', async () => {
      const mappings = Array.from({ length: 101 }, (_, i) => ({
        sourceCategoryId: `src-cat-${i}`,
        sourceCategoryName: `Category ${i}`,
        localCategoryId: `local-cat-${i}`,
      }));

      await expect(service.setMappings(calendarId, sourceActorId, mappings)).rejects.toThrow();
    });

    it('should throw with descriptive message when over limit', async () => {
      const mappings = Array.from({ length: 101 }, (_, i) => ({
        sourceCategoryId: `src-cat-${i}`,
        sourceCategoryName: `Category ${i}`,
        localCategoryId: `local-cat-${i}`,
      }));

      await expect(service.setMappings(calendarId, sourceActorId, mappings)).rejects.toThrow(/100/);
    });

    it('should delete existing mappings and create new ones transactionally', async () => {
      const destroyStub = sandbox.stub(CalendarCategoryMappingEntity, 'destroy').resolves(2 as any);
      const createStub = sandbox.stub(CalendarCategoryMappingEntity, 'create').resolves({} as any);

      const mappings = [
        { sourceCategoryId: 'src-1', sourceCategoryName: 'Music', localCategoryId: 'local-1' },
        { sourceCategoryId: 'src-2', sourceCategoryName: 'Art', localCategoryId: 'local-2' },
      ];

      await service.setMappings(calendarId, sourceActorId, mappings);

      expect(destroyStub.calledOnce).toBeTruthy();
      expect(destroyStub.firstCall.args[0]).toMatchObject({
        where: {
          following_calendar_id: calendarId,
          source_calendar_actor_id: sourceActorId,
        },
      });
      expect(createStub.callCount).toBe(2);
      expect(mockTransaction.commit.calledOnce).toBeTruthy();
      expect(mockTransaction.rollback.called).toBeFalsy();
    });

    it('should handle empty mappings array (clears all mappings)', async () => {
      const destroyStub = sandbox.stub(CalendarCategoryMappingEntity, 'destroy').resolves(2 as any);
      const createStub = sandbox.stub(CalendarCategoryMappingEntity, 'create').resolves({} as any);

      await service.setMappings(calendarId, sourceActorId, []);

      expect(destroyStub.calledOnce).toBeTruthy();
      expect(createStub.called).toBeFalsy();
      expect(mockTransaction.commit.calledOnce).toBeTruthy();
    });

    it('should accept exactly 100 mappings without throwing', async () => {
      sandbox.stub(CalendarCategoryMappingEntity, 'destroy').resolves(0 as any);
      sandbox.stub(CalendarCategoryMappingEntity, 'create').resolves({} as any);

      const mappings = Array.from({ length: 100 }, (_, i) => ({
        sourceCategoryId: `src-cat-${i}`,
        sourceCategoryName: `Category ${i}`,
        localCategoryId: `local-cat-${i}`,
      }));

      await expect(service.setMappings(calendarId, sourceActorId, mappings)).resolves.toBeUndefined();
    });

    it('should rollback transaction on error', async () => {
      sandbox.stub(CalendarCategoryMappingEntity, 'destroy').rejects(new Error('DB error'));

      const mappings = [
        { sourceCategoryId: 'src-1', sourceCategoryName: 'Music', localCategoryId: 'local-1' },
      ];

      await expect(service.setMappings(calendarId, sourceActorId, mappings)).rejects.toThrow('DB error');
      expect(mockTransaction.rollback.calledOnce).toBeTruthy();
      expect(mockTransaction.commit.called).toBeFalsy();
    });
  });

  describe('applyMappings', () => {
    it('should return empty array when no mappings exist', async () => {
      sandbox.stub(CalendarCategoryMappingEntity, 'findAll').resolves([]);

      const result = await service.applyMappings(calendarId, sourceActorId, [
        { id: 'src-cat-1' },
        { id: 'src-cat-2' },
      ]);

      expect(result).toEqual([]);
    });

    it('should return empty array when sourceCategories is empty', async () => {
      sandbox.stub(CalendarCategoryMappingEntity, 'findAll').resolves([]);

      const result = await service.applyMappings(calendarId, sourceActorId, []);

      expect(result).toEqual([]);
    });

    it('should return local category IDs for mapped source categories', async () => {
      const mockMappings = [
        { source_category_id: 'src-cat-1', local_category_id: 'local-cat-1' },
        { source_category_id: 'src-cat-2', local_category_id: 'local-cat-2' },
      ];
      sandbox.stub(CalendarCategoryMappingEntity, 'findAll').resolves(mockMappings as any);

      const result = await service.applyMappings(calendarId, sourceActorId, [
        { id: 'src-cat-1' },
        { id: 'src-cat-2' },
      ]);

      expect(result).toEqual(['local-cat-1', 'local-cat-2']);
    });

    it('should skip unmapped source categories', async () => {
      const mockMappings = [
        { source_category_id: 'src-cat-1', local_category_id: 'local-cat-1' },
      ];
      sandbox.stub(CalendarCategoryMappingEntity, 'findAll').resolves(mockMappings as any);

      const result = await service.applyMappings(calendarId, sourceActorId, [
        { id: 'src-cat-1' },
        { id: 'src-cat-unmapped' },
        { id: 'src-cat-also-unmapped' },
      ]);

      expect(result).toEqual(['local-cat-1']);
    });

    it('should return empty array when none of the source categories are mapped', async () => {
      const mockMappings = [
        { source_category_id: 'src-cat-different', local_category_id: 'local-cat-1' },
      ];
      sandbox.stub(CalendarCategoryMappingEntity, 'findAll').resolves(mockMappings as any);

      const result = await service.applyMappings(calendarId, sourceActorId, [
        { id: 'src-cat-1' },
        { id: 'src-cat-2' },
      ]);

      expect(result).toEqual([]);
    });
  });

  describe('hasCompleteMapping', () => {
    it('should return true when sourceCategories is empty', async () => {
      sandbox.stub(CalendarCategoryMappingEntity, 'findAll').resolves([]);

      const result = await service.hasCompleteMapping(calendarId, sourceActorId, []);

      expect(result).toBe(true);
    });

    it('should return true when all source categories are mapped', async () => {
      const mockMappings = [
        { source_category_id: 'src-cat-1', local_category_id: 'local-cat-1' },
        { source_category_id: 'src-cat-2', local_category_id: 'local-cat-2' },
      ];
      sandbox.stub(CalendarCategoryMappingEntity, 'findAll').resolves(mockMappings as any);

      const result = await service.hasCompleteMapping(calendarId, sourceActorId, [
        { id: 'src-cat-1' },
        { id: 'src-cat-2' },
      ]);

      expect(result).toBe(true);
    });

    it('should return false when some source categories are not mapped', async () => {
      const mockMappings = [
        { source_category_id: 'src-cat-1', local_category_id: 'local-cat-1' },
      ];
      sandbox.stub(CalendarCategoryMappingEntity, 'findAll').resolves(mockMappings as any);

      const result = await service.hasCompleteMapping(calendarId, sourceActorId, [
        { id: 'src-cat-1' },
        { id: 'src-cat-2' },
      ]);

      expect(result).toBe(false);
    });

    it('should return false when no mappings exist but source categories provided', async () => {
      sandbox.stub(CalendarCategoryMappingEntity, 'findAll').resolves([]);

      const result = await service.hasCompleteMapping(calendarId, sourceActorId, [
        { id: 'src-cat-1' },
      ]);

      expect(result).toBe(false);
    });

    it('should return true when there are more mappings than source categories (superset)', async () => {
      const mockMappings = [
        { source_category_id: 'src-cat-1', local_category_id: 'local-cat-1' },
        { source_category_id: 'src-cat-2', local_category_id: 'local-cat-2' },
        { source_category_id: 'src-cat-3', local_category_id: 'local-cat-3' },
      ];
      sandbox.stub(CalendarCategoryMappingEntity, 'findAll').resolves(mockMappings as any);

      const result = await service.hasCompleteMapping(calendarId, sourceActorId, [
        { id: 'src-cat-1' },
        { id: 'src-cat-2' },
      ]);

      expect(result).toBe(true);
    });
  });
});
