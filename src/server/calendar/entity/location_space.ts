import { Model, Table, Column, PrimaryKey, BelongsTo, HasMany, DataType, ForeignKey, CreatedAt, UpdatedAt } from 'sequelize-typescript';

import { EventLocationSpace } from '@/common/model/location';
import { LocationEntity } from '@/server/calendar/entity/location';
import { LocationSpaceContentEntity } from '@/server/calendar/entity/location_space_content';

/**
 * Location space database entity.
 * Represents a named sub-area within a Place (e.g. a meeting room within a
 * community center, the gazebo in a park) with translatable name and
 * accessibility information stored on LocationSpaceContentEntity.
 */
@Table({ tableName: 'location_space', timestamps: true })
class LocationSpaceEntity extends Model {
  @PrimaryKey
  @Column({ type: DataType.UUID })
  declare id: string;

  @ForeignKey(() => LocationEntity)
  @Column({ type: DataType.UUID, allowNull: false })
  declare place_id: string;

  // origin_uri identifies AP-originated records for inbound dedup (pv-ix7v).
  // Should be cleared when the source calendar is unfollowed — see follow-up.
  @Column({ type: DataType.STRING(2048), allowNull: true })
  declare origin_uri: string | null;

  @CreatedAt
  declare createdAt: Date;

  @UpdatedAt
  declare updatedAt: Date;

  @HasMany(() => LocationSpaceContentEntity)
  declare content: LocationSpaceContentEntity[];

  @BelongsTo(() => LocationEntity)
  declare place: LocationEntity;

  toModel(): EventLocationSpace {
    const space = new EventLocationSpace(this.id, this.place_id);
    space.originUri = this.origin_uri ?? null;

    // Read computed eventCount from dataValues. Populated by callers that add
    // `[literal(...), 'eventCount']` via attributes.include on the eager-load
    // (see LocationService); absent on plain finds, in which case the field
    // stays undefined on the model (pv-0pht).
    const rawEventCount = this.getDataValue('eventCount' as any);
    if (rawEventCount !== undefined && rawEventCount !== null) {
      const parsed = typeof rawEventCount === 'number' ? rawEventCount : Number(rawEventCount);
      if (!Number.isNaN(parsed)) {
        space.eventCount = parsed;
      }
    }

    if (this.content) {
      for (const contentEntity of this.content) {
        space.addContent(contentEntity.toModel());
      }
    }

    return space;
  }

  static fromModel(space: EventLocationSpace): LocationSpaceEntity {
    return LocationSpaceEntity.build({
      id: space.id,
      place_id: space.placeId,
      origin_uri: space.originUri ?? null,
    });
  }
}

// Note: LocationSpaceEntity and LocationSpaceContentEntity are registered
// alongside LocationEntity in location.ts to ensure LocationEntity is fully
// defined before sequelize-typescript resolves the @ForeignKey association
// on place_id.

export {
  LocationSpaceEntity,
  LocationSpaceContentEntity,
};
