def sequence(raw):
    if isinstance(raw, tuple):
        raw = next((value for value in raw if not isinstance(value, int)), [])
    return list(raw or [])

def load_image(filename):
    try:
        image = Gimp.file_load(Gimp.RunMode.NONINTERACTIVE, Gio.File.new_for_path(filename))
    except Exception as error:
        raise CliFailure(400, "Could not load " + filename + ": " + str(error))
    if image is None:
        raise CliFailure(400, "GIMP could not load " + filename)
    return image

def save_image(image, filename):
    try:
        saved = Gimp.file_save(Gimp.RunMode.NONINTERACTIVE, image, Gio.File.new_for_path(filename), None)
    except Exception as error:
        raise CliFailure(500, "GIMP could not save " + filename + ": " + str(error))
    if not saved:
        raise CliFailure(500, "GIMP could not save " + filename)

def all_layers(layers):
    result = []
    for layer in sequence(layers):
        result.append(layer)
        if isinstance(layer, Gimp.GroupLayer):
            result.extend(all_layers(layer.get_children()))
    return result

def encode_component(value):
    return value.replace("~", "~0").replace("/", "~1")

def decode_component(value):
    return value.replace("~1", "/").replace("~0", "~")

def item_path(parent, item):
    component = encode_component(item.get_name())
    return component if not parent else parent + "/" + component

def find_item(image, item_path_value):
    parts = [decode_component(part) for part in item_path_value.split("/") if part]
    if not parts:
        raise CliFailure(400, "Layer path cannot be empty")
    siblings = sequence(image.get_layers())
    item = None
    for index, part in enumerate(parts):
        matches = [candidate for candidate in siblings if candidate.get_name() == part]
        if not matches:
            raise CliFailure(404, "No layer/group at path " + item_path_value)
        if len(matches) > 1:
            raise CliFailure(400, "Layer path is ambiguous: " + item_path_value)
        item = matches[0]
        if index < len(parts) - 1:
            if not isinstance(item, Gimp.GroupLayer):
                raise CliFailure(400, "Path component is not a group: " + part)
            siblings = sequence(item.get_children())
    return item

def find_group(image, item_path_value):
    group = find_item(image, item_path_value)
    if not isinstance(group, Gimp.GroupLayer):
        raise CliFailure(400, "Destination is not a group: " + item_path_value)
    return group

def parent_and_siblings(image, item):
    parent = item.get_parent()
    siblings = sequence(parent.get_children()) if parent is not None else sequence(image.get_layers())
    return parent, siblings

def ensure_root(image):
    name = "Root"
    top = sequence(image.get_layers())
    roots = [item for item in top if isinstance(item, Gimp.GroupLayer) and item.get_name() == name]
    if len(roots) > 1:
        raise CliFailure(400, "More than one top-level group is named " + name)
    root = roots[0] if roots else None
    if root is None:
        if any(item.get_name() == name for item in top):
            raise CliFailure(400, "A non-group layer is already named " + name)
        root = Gimp.GroupLayer.new(image, name)
        if root is None or not image.insert_layer(root, None, 0):
            raise CliFailure(500, "GIMP could not create the root group " + name)
        for index, item in enumerate(top):
            if not image.reorder_item(item, root, index):
                raise CliFailure(500, "GIMP could not move an existing layer into the root group")
    else:
        position = len(sequence(root.get_children()))
        for item in top:
            if item != root:
                if not image.reorder_item(item, root, position):
                    raise CliFailure(500, "GIMP could not move an existing layer into the root group")
                position += 1
    return root

def offsets(layer):
    raw = layer.get_offsets()
    if isinstance(raw, tuple) and len(raw) >= 3 and isinstance(raw[0], bool):
        return raw[1], raw[2]
    return raw[0], raw[1]

def layer_info(layer, parent_path=""):
    x, y = offsets(layer)
    group = isinstance(layer, Gimp.GroupLayer)
    path = item_path(parent_path, layer)
    value = {
        "name": layer.get_name(),
        "path": path,
        "visible": layer.get_visible(),
        "opacity": layer.get_opacity(),
        "width": layer.get_width(),
        "height": layer.get_height(),
        "x": x,
        "y": y,
        "group": group,
    }
    mask = layer.get_mask()
    if mask is not None:
        value["mask"] = {
            "name": mask.get_name(),
            "visible": mask.get_visible(),
            "opacity": mask.get_opacity(),
            "showMask": layer.get_show_mask(),
            "applyMask": layer.get_apply_mask(),
            "editMask": layer.get_edit_mask(),
        }
    if group:
        value["children"] = [layer_info(child, path) for child in sequence(layer.get_children())]
    return value

def image_info(image, filename):
    return {
        "file": filename,
        "width": image.get_width(),
        "height": image.get_height(),
        "baseType": str(image.get_base_type()),
        "layers": [layer_info(layer) for layer in sequence(image.get_layers())],
    }

def save_result(image, filename):
    save_image(image, filename)
    return {
        "file": filename,
        "width": image.get_width(),
        "height": image.get_height(),
        "format": filename.rsplit(".", 1)[-1].upper() if "." in filename else "",
        "layers": len(all_layers(image.get_layers())),
    }

def isolate_item(image, item):
    current = item
    while current is not None:
        parent = current.get_parent()
        siblings = sequence(parent.get_children()) if parent is not None else sequence(image.get_layers())
        for sibling in siblings:
            if sibling != current and not image.remove_layer(sibling):
                raise CliFailure(500, "GIMP could not isolate the selected layer/group")
        current = parent

def visible_item(image, item):
    current = item
    while current is not None:
        current.set_visible(True)
        current = current.get_parent()

def export_mask(image, item_path_value, filename):
    copy = image.duplicate()
    item = find_item(copy, item_path_value)
    if item.get_mask() is None:
        return False
    visible_item(copy, item)
    isolate_item(copy, item)
    if not item.set_show_mask(True):
        raise CliFailure(500, "GIMP could not display the layer mask for export")
    save_image(copy, filename)
    return True
