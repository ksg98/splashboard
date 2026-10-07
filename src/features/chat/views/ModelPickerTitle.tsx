import { ChevronDown } from 'lucide-react';
import { Menu, type MenuItem } from '@/components/ui/Menu';
import type { PickerModel } from './types';
import './ModelPickerTitle.css';

export interface ModelPickerTitleProps {
  /**
   * Installed Splash packages and MLX models. Each name is unique (other
   * versions carry theirs: "Qwen3.8-27B (MLX 4-bit)") and each has a gray
   * detail line (publisher, size, state) so versions are told apart.
   */
  models: PickerModel[];
  /** Id of the model chats use now. */
  value: string;
  onChange: (id: string) => void;
  /** "Manage models…" at the end of the menu. */
  onManageModels?: () => void;
  /** Shown under the list. Pass "" to hide. */
  note?: string;
  /** Opens with the menu showing (gallery). */
  defaultOpen?: boolean;
}

/**
 * The model pop-up in the toolbar's title position, as ChatGPT has it: the
 * name in 16 px semibold with a chevron; the menu checks the current model.
 */
export function ModelPickerTitle({
  models,
  value,
  onChange,
  onManageModels,
  note = 'Switching models restarts the server.',
  defaultOpen,
}: ModelPickerTitleProps) {
  const current = models.find((model) => model.id === value);
  const items: MenuItem[] = models.map(
    (model): MenuItem => ({
      id: model.id,
      label: model.name,
      description: model.detail,
      checked: model.id === value,
      onSelect: () => {
        if (model.id !== value) onChange(model.id);
      },
    }),
  );
  if (note) items.push({ type: 'note', label: note });
  if (onManageModels) {
    items.push({ type: 'separator' });
    items.push({ id: 'manage-models', label: 'Manage models…', onSelect: onManageModels });
  }

  const name = current?.name ?? 'Choose a model';
  return (
    <Menu
      side="bottom"
      align="start"
      width={300}
      items={items}
      aria-label="Model"
      defaultOpen={defaultOpen}
      trigger={
        <button type="button" className="ch-title-picker" aria-label={`Model: ${name}`}>
          <span className="ch-title-picker-name">{name}</span>
          <ChevronDown size={14} strokeWidth={1.75} aria-hidden />
        </button>
      }
    />
  );
}
