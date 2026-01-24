import {
  Model,
  Column,
  Table,
  BelongsTo,
  ForeignKey,
  DataType,
  PrimaryKey,
  Index,
} from 'sequelize-typescript';
import { v4 as uuidv4 } from 'uuid';

import { CalendarEntity } from '@/server/calendar/entity/calendar';
import { AccountEntity } from '@/server/common/entity/account';
import db from '@/server/common/entity/db';

/**
 * CalendarEditorPersonEntity
 *
 * Represents a person (local account) who has been granted editor access to a calendar.
 * Editors can create, update, and delete events on the calendar but cannot delete the
 * calendar itself or manage other editors.
 */
@Table({
  tableName: 'calendar_editor_person',
  underscored: true,
  indexes: [
    {
      unique: true,
      fields: ['calendar_id', 'account_id'],
      name: 'unique_calendar_editor_person',
    },
  ],
})
class CalendarEditorPersonEntity extends Model {
  @PrimaryKey
  @Column({ type: DataType.UUID, defaultValue: () => uuidv4() })
  declare id: string;

  @ForeignKey(() => CalendarEntity)
  @Column({ type: DataType.UUID, allowNull: false })
  @Index
  declare calendar_id: string;

  @ForeignKey(() => AccountEntity)
  @Column({ type: DataType.UUID, allowNull: false })
  @Index
  declare account_id: string;

  @ForeignKey(() => AccountEntity)
  @Column({ type: DataType.UUID, allowNull: false })
  declare granted_by: string;

  @BelongsTo(() => CalendarEntity, { onDelete: 'CASCADE' })
  declare calendar: CalendarEntity;

  @BelongsTo(() => AccountEntity, { foreignKey: 'account_id' })
  declare account: AccountEntity;

  @BelongsTo(() => AccountEntity, { foreignKey: 'granted_by', as: 'grantor' })
  declare grantor: AccountEntity;
}

db.addModels([CalendarEditorPersonEntity]);

export { CalendarEditorPersonEntity };
