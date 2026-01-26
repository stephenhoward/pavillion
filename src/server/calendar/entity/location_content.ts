import { Model, Table, Column, PrimaryKey, BelongsTo, DataType, ForeignKey } from 'sequelize-typescript';

import { EventLocationContent } from '@/common/model/location';
import { LocationEntity } from '@/server/calendar/entity/location';

/**
 * Location content database entity.
 * Represents translatable accessibility information for locations.
 */
@Table({ tableName: 'location_content', timestamps: false })
export class LocationContentEntity extends Model {
  @PrimaryKey
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4 })
  declare id: string;

  @ForeignKey(() => LocationEntity)
  @Column({ type: DataType.UUID })
  declare location_id: string;

  @Column({ type: DataType.STRING })
  declare language: string;

  @Column({ type: DataType.TEXT })
  declare accessibility_info: string;

  @BelongsTo(() => LocationEntity)
  declare location: LocationEntity;

  toModel(): EventLocationContent {
    return new EventLocationContent(
      this.language,
      this.accessibility_info ?? '',
    );
  }

  static fromModel(locationId: string, content: EventLocationContent): LocationContentEntity {
    return LocationContentEntity.build({
      location_id: locationId,
      language: content.language,
      accessibility_info: content.accessibilityInfo,
    });
  }
}

// Note: LocationContentEntity is registered by LocationEntity
