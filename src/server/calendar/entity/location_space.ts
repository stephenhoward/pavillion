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
