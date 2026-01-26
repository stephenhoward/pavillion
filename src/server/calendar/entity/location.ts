import { Model, Table, Column, PrimaryKey, BelongsTo, HasMany, DataType, ForeignKey, CreatedAt, UpdatedAt } from 'sequelize-typescript';

import { EventLocation } from '@/common/model/location';
import db from '@/server/common/entity/db';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import { LocationContentEntity } from '@/server/calendar/entity/location_content';

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

  @CreatedAt
  declare createdAt: Date;

  @UpdatedAt
  declare updatedAt: Date;

  @HasMany(() => LocationContentEntity)
  declare content: LocationContentEntity[];

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

    // Add content if loaded
    if (this.content) {
      for (const contentEntity of this.content) {
        location.addContent(contentEntity.toModel());
      }
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
    });
  }
}

// Register both entities with Sequelize to ensure proper associations
db.addModels([LocationEntity, LocationContentEntity]);

export {
  LocationEntity,
  LocationContentEntity,
};
