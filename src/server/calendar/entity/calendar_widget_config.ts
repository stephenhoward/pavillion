import {
  Model,
  Column,
  Table,
  BelongsTo,
  ForeignKey,
  DataType,
  PrimaryKey,
  CreatedAt,
  UpdatedAt,
} from 'sequelize-typescript';

import { WidgetConfig, WidgetView, WidgetColorMode } from '@/common/model/widget_config';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import db from '@/server/common/entity/db';

/**
 * CalendarWidgetConfigEntity
 *
 * Stores per-calendar widget display configuration (view mode, accent color,
 * color mode) that the widget SDK/iframe reads at render time. Replaces the
 * previous approach of passing these settings as embed-snippet query-string
 * arguments so that calendar owners can change them in the admin UI without
 * touching the HTML on their embedding site.
 *
 * One row per calendar enforced via unique FK on calendar_id. No row is
 * created until the owner explicitly saves a config; widget serving falls
 * through to hardcoded defaults until then.
 */
@Table({
  tableName: 'calendar_widget_config',
  timestamps: true,
  underscored: true,
})
class CalendarWidgetConfigEntity extends Model {
  @PrimaryKey
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4 })
  declare id: string;

  @ForeignKey(() => CalendarEntity)
  @Column({ type: DataType.UUID, allowNull: false })
  declare calendar_id: string;

  @Column({ type: DataType.STRING, allowNull: false })
  declare view: string;

  @Column({ type: DataType.STRING, allowNull: false })
  declare accent_color: string;

  @Column({ type: DataType.STRING, allowNull: false })
  declare color_mode: string;

  @CreatedAt
  declare created_at: Date;

  @UpdatedAt
  declare updated_at: Date;

  @BelongsTo(() => CalendarEntity, { foreignKey: 'calendar_id', onDelete: 'CASCADE' })
  declare calendar: CalendarEntity;

  /**
   * Converts the entity to a WidgetConfig domain model.
   */
  toModel(): WidgetConfig {
    return new WidgetConfig(
      this.view as WidgetView,
      this.accent_color,
      this.color_mode as WidgetColorMode,
    );
  }

  /**
   * Creates a CalendarWidgetConfigEntity from a WidgetConfig domain model.
   *
   * The domain model only carries the three presentation fields (view,
   * accentColor, colorMode). The entity's identity fields (id, calendar_id)
   * must be supplied by the caller because they are not part of the domain
   * model's concerns.
   *
   * @param model - WidgetConfig domain model to convert
   * @param id - Entity row id (generated on creation, reused on update)
   * @param calendarId - FK to the owning calendar
   */
  static fromModel(
    model: WidgetConfig,
    id: string,
    calendarId: string,
  ): CalendarWidgetConfigEntity {
    return CalendarWidgetConfigEntity.build({
      id,
      calendar_id: calendarId,
      view: model.view,
      accent_color: model.accentColor,
      color_mode: model.colorMode,
    });
  }
}

db.addModels([CalendarWidgetConfigEntity]);

export { CalendarWidgetConfigEntity };
