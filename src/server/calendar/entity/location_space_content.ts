import { Model, Table, Column, PrimaryKey, BelongsTo, DataType, ForeignKey } from 'sequelize-typescript';

import { EventLocationSpaceContent } from '@/common/model/location';
import { LocationSpaceEntity } from '@/server/calendar/entity/location_space';

/**
 * Location space content database entity.
 * Represents translatable name and accessibility information for a space within a location.
 */
@Table({ tableName: 'location_space_content', timestamps: false })
export class LocationSpaceContentEntity extends Model {
  @PrimaryKey
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4 })
  declare id: string;

  @ForeignKey(() => LocationSpaceEntity)
  @Column({ type: DataType.UUID, allowNull: false })
  declare space_id: string;

  @Column({ type: DataType.STRING, allowNull: false })
  declare language: string;

  @Column({ type: DataType.STRING, allowNull: false })
  declare name: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  declare accessibility_info: string;

  @BelongsTo(() => LocationSpaceEntity)
  declare space: LocationSpaceEntity;

  toModel(): EventLocationSpaceContent {
    return new EventLocationSpaceContent(
      this.language,
      this.name ?? '',
      this.accessibility_info ?? '',
    );
  }

  static fromModel(spaceId: string, content: EventLocationSpaceContent): LocationSpaceContentEntity {
    return LocationSpaceContentEntity.build({
      space_id: spaceId,
      language: content.language,
      name: content.name,
      accessibility_info: content.accessibilityInfo,
    });
  }
}

// Note: LocationSpaceContentEntity is registered by LocationSpaceEntity
