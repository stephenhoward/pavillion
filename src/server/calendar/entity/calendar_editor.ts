import { Model, Column, Table, BelongsTo, ForeignKey, DataType, PrimaryKey, CreatedAt, UpdatedAt } from 'sequelize-typescript';

import { AccountEntity } from '@/server/common/entity/account';
import { CalendarEntity } from './calendar';
import { CalendarEditor } from '@/common/model/calendar_editor';
import db from '@/server/common/entity/db';

/**
 * Database entity for calendar editor relationships
 * Simple binary access model: either someone has edit access or they don't
 */
@Table({ tableName: 'calendar_editor' })
class CalendarEditorEntity extends Model {

  @PrimaryKey
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4 })
  declare id: string;

  @ForeignKey(() => CalendarEntity)
  @Column({ type: DataType.UUID, allowNull: false })
  declare calendar_id: string;

  @BelongsTo(() => CalendarEntity)
  declare calendar: CalendarEntity;

  @ForeignKey(() => AccountEntity)
  @Column({ type: DataType.UUID, allowNull: false })
  declare account_id: string;

  @BelongsTo(() => AccountEntity)
  declare account: AccountEntity;

  @CreatedAt
  declare createdAt: Date;

  @UpdatedAt
  declare updatedAt: Date;

  /**
   * Convert entity to model
   */
  toModel(): CalendarEditor {
    return new CalendarEditor(
      this.id,
      this.calendar_id,
      this.account_id,
    );
  }

  /**
   * Create entity from model
   */
  static fromModel(editor: CalendarEditor): CalendarEditorEntity {
    return CalendarEditorEntity.build({
      id: editor.id,
      calendar_id: editor.calendarId,
      account_id: editor.accountId,
    });
  }
}

db.addModels([CalendarEditorEntity]);

export { CalendarEditorEntity };
