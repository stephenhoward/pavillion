import { Model, Table, Column, PrimaryKey, BelongsTo, HasMany, DataType, ForeignKey, CreatedAt, UpdatedAt } from 'sequelize-typescript';

import { EventLocation } from '@/common/model/location';
import db from '@/server/common/entity/db';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import { LocationContentEntity } from '@/server/calendar/entity/location_content';
import { LocationSpaceEntity } from '@/server/calendar/entity/location_space';

@Table({ tableName: 'location', timestamps: true })
class LocationEntity extends Model {
  @PrimaryKey
  @Column({ type: DataType.UUID })
  declare id: string;

  @ForeignKey(() => CalendarEntity)
  @Column({ type: DataType.UUID })
  declare calendar_id: string;

  @Column({ type: DataType.STRING })
  declare name: string;

  @Column({ type: DataType.STRING })
  declare address: string;

  @Column({ type: DataType.STRING })
  declare city: string;

  @Column({ type: DataType.STRING })
  declare state: string;

  @Column({ type: DataType.STRING })
  declare postal_code: string;

  @Column({ type: DataType.STRING })
  declare country: string;

  // origin_uri identifies AP-originated records for inbound dedup (pv-ix7v).
  // Should be cleared when the source calendar is unfollowed — see follow-up.
  @Column({ type: DataType.STRING(2048), allowNull: true })
  declare origin_uri: string | null;

  @CreatedAt
  declare createdAt: Date;

  @UpdatedAt
  declare updatedAt: Date;

  @HasMany(() => LocationContentEntity)
  declare content: LocationContentEntity[];

  @HasMany(() => LocationSpaceEntity)
  declare spaces: LocationSpaceEntity[];

  @BelongsTo(() => CalendarEntity)
  declare calendar: CalendarEntity;

  toModel(): EventLocation {
    const location = new EventLocation(
      this.id,
      this.name,
      this.address,
      this.city,
      this.state,
      this.postal_code,
      this.country,
    );
    location.originUri = this.origin_uri ?? null;

    // Add content if loaded
    if (this.content) {
      for (const contentEntity of this.content) {
        location.addContent(contentEntity.toModel());
      }
    }

    // Add spaces if eager-loaded. Each space's toModel() picks up its computed
    // eventCount from dataValues when the eager-load attached the literal
    // subquery (pv-0pht).
    if (this.spaces) {
      location.spaces = this.spaces.map(spaceEntity => spaceEntity.toModel());
    }

    return location;
  }

  static fromModel(location: EventLocation): LocationEntity {
    return LocationEntity.build({
      id: location.id,
      name: location.name,
      address: location.address,
      city: location.city,
      state: location.state,
      postal_code: location.postalCode,
      country: location.country,
      origin_uri: location.originUri ?? null,
    });
  }
}

// Register all related entities with Sequelize to ensure proper associations.
// LocationSpaceEntity and LocationSpaceContentEntity are registered here
// rather than in location_space.ts to avoid a circular-load failure: when
// location_space.ts is loaded as a side-effect of location.ts loading,
// LocationEntity is not yet defined, so LocationSpaceEntity's @ForeignKey
// reference cannot be resolved at addModels time.
import { LocationSpaceContentEntity } from '@/server/calendar/entity/location_space_content';
db.addModels([LocationEntity, LocationContentEntity, LocationSpaceEntity, LocationSpaceContentEntity]);

export {
  LocationEntity,
  LocationContentEntity,
};
